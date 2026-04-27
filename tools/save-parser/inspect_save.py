#!/usr/bin/env python3
"""
Diagnostic Satisfactory .sav inspector.

This is a proof-of-concept save-file parser for the Satisfactory Floor Planner.

Current goal:
- Parse save header.
- Decompress Satisfactory save chunks.
- Scan decompressed save data for placed miners/extractors/geothermal generators.
- Recover world coordinates where the actor header is visible.
- Write debug JSON for later map overlay work.

This is not a full polished save parser yet.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import sys
import zlib
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_PATH = Path("tools/save-parser/output/save_overlay_debug.json")

UNREAL_COMPRESSED_SIGNATURE = 0x9E2A83C1
UNREAL_COMPRESSED_TAG = 0x22222222

PLAUSIBLE_XY_ABS_MAX = 500_000.0
PLAUSIBLE_Z_ABS_MAX = 100_000.0

TARGETS = {
    "Miner Mk.1": "Build_MinerMk1_C",
    "Miner Mk.2": "Build_MinerMk2_C",
    "Miner Mk.3": "Build_MinerMk3_C",
    "Oil Extractor": "Build_OilPump_C",
    "Water Extractor": "Build_WaterPump_C",
    "Resource Well Extractor": "Build_FrackingExtractor_C",
    "Resource Well Pressurizer": "Build_FrackingSmasher_C",
    "Geothermal Generator": "Build_GeneratorGeoThermal_C",
}

REFERENCE_PATTERNS = {
    "resource_node_references": b"BP_ResourceNode",
    "fracking_core_references": b"BP_FrackingCore",
    "fracking_satellite_references": b"BP_FrackingSatellite",
}


@dataclass
class SaveHeader:
    path: str
    file_size_bytes: int
    save_header_version: int | None = None
    save_version: int | None = None
    build_version: int | None = None
    save_name: str | None = None
    map_name: str | None = None
    map_options: str | None = None
    session_name: str | None = None
    play_duration_seconds: int | None = None
    save_date_ticks: int | None = None
    session_visibility: int | None = None
    editor_object_version: int | None = None
    mod_metadata_raw: str | None = None
    is_modded_save: bool | None = None
    save_identifier: str | None = None
    is_partitioned_world: bool | None = None
    is_creative_mode_enabled: bool | None = None
    parse_notes: list[str] | None = None


@dataclass
class FoundActor:
    label: str
    actor_name: str
    token: str
    offset: int
    x: float | None = None
    y: float | None = None
    z: float | None = None
    coordinate_confidence: str = "none"
    coordinate_source: str | None = None
    nearby_ascii: str | None = None
    possible_resource_reference: str | None = None


class ParseError(Exception):
    pass


class BinaryReader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def read_u8(self) -> int:
        self._require(1)
        value = self.data[self.pos]
        self.pos += 1
        return value

    def read_i32(self) -> int:
        self._require(4)
        value = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return value

    def read_u32(self) -> int:
        self._require(4)
        value = struct.unpack_from("<I", self.data, self.pos)[0]
        self.pos += 4
        return value

    def read_u64(self) -> int:
        self._require(8)
        value = struct.unpack_from("<Q", self.data, self.pos)[0]
        self.pos += 8
        return value

    def read_bytes(self, count: int) -> bytes:
        self._require(count)
        value = self.data[self.pos:self.pos + count]
        self.pos += count
        return value

    def read_fstring(self, max_chars: int = 20_000) -> str:
        """
        Unreal FString:
        - int32 length
        - positive length = UTF-8-ish bytes including null terminator
        - negative length = UTF-16 little-endian including null terminator
        """
        length = self.read_i32()

        if length == 0:
            return ""

        if abs(length) > max_chars:
            raise ParseError(f"Suspicious FString length {length} at offset {self.pos - 4}")

        if length > 0:
            raw = self.read_bytes(length)
            return raw.rstrip(b"\x00").decode("utf-8", errors="replace")

        byte_count = abs(length) * 2
        raw = self.read_bytes(byte_count)
        return raw.rstrip(b"\x00").decode("utf-16-le", errors="replace")

    def _require(self, count: int) -> None:
        if self.pos + count > len(self.data):
            raise ParseError(f"Unexpected end of data at offset {self.pos}; wanted {count} bytes")


def safe_text(value: Any, max_len: int = 500) -> str | None:
    if value is None:
        return None

    text = str(value)
    cleaned = []

    for ch in text:
        code = ord(ch)
        if ch in "\r\n\t" or 32 <= code <= 126:
            cleaned.append(ch)
        else:
            cleaned.append("�")

    result = "".join(cleaned)
    result = re.sub(r"\s+", " ", result).strip()

    if len(result) > max_len:
        return result[:max_len] + "...[truncated]"

    return result


def parse_bool_u32(value: int) -> bool:
    return bool(value)


def parse_header(data: bytes, save_path: Path) -> tuple[SaveHeader, int]:
    notes: list[str] = []
    reader = BinaryReader(data)

    header = SaveHeader(
        path=str(save_path),
        file_size_bytes=len(data),
        parse_notes=notes,
    )

    try:
        header.save_header_version = reader.read_u32()
        header.save_version = reader.read_u32()
        header.build_version = reader.read_u32()

        header.save_name = reader.read_fstring()
        header.map_name = reader.read_fstring()
        header.map_options = reader.read_fstring()
        header.session_name = reader.read_fstring()

        header.play_duration_seconds = reader.read_u32()
        header.save_date_ticks = reader.read_u64()

        # This is the byte that the previous script got wrong.
        header.session_visibility = reader.read_u8()

        header.editor_object_version = reader.read_u32()
        header.mod_metadata_raw = reader.read_fstring()
        header.is_modded_save = parse_bool_u32(reader.read_u32())
        header.save_identifier = reader.read_fstring()

        # Current saves include these after saveIdentifier.
        header.is_partitioned_world = parse_bool_u32(reader.read_u32())

        # Observed as another required 1 in the maintained parser.
        _unknown_confirmed_one = reader.read_u32()

        _save_hash_1 = reader.read_u64()
        _save_hash_2 = reader.read_u64()

        header.is_creative_mode_enabled = parse_bool_u32(reader.read_u32())

    except Exception as exc:
        notes.append(f"Header parse stopped early: {exc!r}")

    return header, reader.pos


def decompress_save_chunks(data: bytes, start_offset: int, verbose: bool = False) -> tuple[bytes, list[dict[str, Any]]]:
    """
    Decompress the list of Unreal/Satisfactory compressed chunks.

    Each chunk begins with:
    - uint32 0x9e2a83c1
    - uint32 0x22222222
    - uint8  0
    - uint32 maximum chunk size
    - uint32 0x03000000
    - uint64 compressed length 1
    - uint64 uncompressed length 1
    - uint64 compressed length 2
    - uint64 uncompressed length 2
    - zlib compressed payload
    """
    reader = BinaryReader(data)
    reader.pos = start_offset

    parts: list[bytes] = []
    reports: list[dict[str, Any]] = []
    chunk_index = 0

    while reader.pos < len(data):
        chunk_start = reader.pos

        signature = reader.read_u32()
        if signature != UNREAL_COMPRESSED_SIGNATURE:
            raise ParseError(
                f"Expected compressed signature {hex(UNREAL_COMPRESSED_SIGNATURE)} "
                f"at offset {chunk_start}, got {hex(signature)}"
            )

        tag = reader.read_u32()
        if tag != UNREAL_COMPRESSED_TAG:
            raise ParseError(
                f"Expected compressed tag {hex(UNREAL_COMPRESSED_TAG)} "
                f"at offset {chunk_start + 4}, got {hex(tag)}"
            )

        zero = reader.read_u8()
        max_chunk_size = reader.read_u32()
        compression_marker = reader.read_u32()

        compressed_len_1 = reader.read_u64()
        uncompressed_len_1 = reader.read_u64()
        compressed_len_2 = reader.read_u64()
        uncompressed_len_2 = reader.read_u64()

        if compressed_len_1 != compressed_len_2:
            raise ParseError(f"Compressed size mismatch in chunk {chunk_index}")

        if uncompressed_len_1 != uncompressed_len_2:
            raise ParseError(f"Uncompressed size mismatch in chunk {chunk_index}")

        compressed_payload = reader.read_bytes(compressed_len_1)
        decompressed_payload = zlib.decompress(compressed_payload)

        if len(decompressed_payload) != uncompressed_len_1:
            raise ParseError(
                f"Chunk {chunk_index} decompressed to {len(decompressed_payload)} bytes, "
                f"expected {uncompressed_len_1}"
            )

        parts.append(decompressed_payload)

        reports.append({
            "chunk_index": chunk_index,
            "offset": chunk_start,
            "zero": zero,
            "max_chunk_size": max_chunk_size,
            "compression_marker": hex(compression_marker),
            "compressed_bytes": compressed_len_1,
            "uncompressed_bytes": uncompressed_len_1,
        })

        if verbose and chunk_index < 5:
            print(
                f"[debug] chunk {chunk_index}: "
                f"{compressed_len_1:,} compressed -> {uncompressed_len_1:,} decompressed"
            )

        chunk_index += 1

    return b"".join(parts), reports


def decode_nearby_ascii(blob: bytes, center: int, radius: int = 500) -> str:
    start = max(0, center - radius)
    end = min(len(blob), center + radius)
    window = blob[start:end]

    text = "".join(chr(b) if 32 <= b <= 126 else " " for b in window)
    text = re.sub(r"\s+", " ", text).strip()
    return safe_text(text, max_len=1200) or ""


def is_plausible_coordinate_triple(x: float, y: float, z: float) -> bool:
    if not all(math.isfinite(value) for value in (x, y, z)):
        return False

    if abs(x) > PLAUSIBLE_XY_ABS_MAX:
        return False

    if abs(y) > PLAUSIBLE_XY_ABS_MAX:
        return False

    if abs(z) > PLAUSIBLE_Z_ABS_MAX:
        return False

    if abs(x) + abs(y) < 1_000:
        return False

    return True


def find_possible_resource_reference(nearby_ascii: str | None) -> str | None:
    if not nearby_ascii:
        return None

    patterns = [
        r"mExtractableResource",
        r"BP_ResourceNode[\w_./:-]*",
        r"ResourceNode[\w_./:-]*",
        r"BP_FrackingCore[\w_./:-]*",
        r"BP_FrackingSatellite[\w_./:-]*",
    ]

    for pattern in patterns:
        match = re.search(pattern, nearby_ascii)
        if match:
            return match.group(0)

    return None


def coordinate_score(actor_offset: int, coord_offset: int, x: float, y: float, z: float) -> float:
    distance = abs(coord_offset - actor_offset)
    score = 0.0

    score += max(0, 2_000 - distance)
    score += min(1_000, (abs(x) + abs(y)) / 200)

    if abs(z) > 100:
        score += 100

    # In actual actor headers, transform floats are usually shortly after the actor name.
    if 0 <= coord_offset - actor_offset <= 220:
        score += 2_000

    return score


def extract_nearby_coordinates(blob: bytes, actor_offset: int, search_radius: int = 700) -> tuple[tuple[float, float, float] | None, str, str | None]:
    start = max(0, actor_offset - search_radius)
    end = min(len(blob) - 12, actor_offset + search_radius)

    candidates: list[dict[str, Any]] = []

    for offset in range(start, end, 4):
        try:
            x, y, z = struct.unpack_from("<fff", blob, offset)
        except struct.error:
            continue

        if not is_plausible_coordinate_triple(x, y, z):
            continue

        candidates.append({
            "offset": offset,
            "coords": (x, y, z),
            "score": coordinate_score(actor_offset, offset, x, y, z),
            "distance": abs(offset - actor_offset),
        })

    if not candidates:
        return None, "none", None

    candidates.sort(key=lambda item: item["score"], reverse=True)
    best = candidates[0]
    x, y, z = best["coords"]

    confidence = "low"

    relative = best["offset"] - actor_offset
    if 0 <= relative <= 220 and (abs(x) + abs(y)) > 10_000:
        confidence = "medium"

    if 0 <= relative <= 120 and (abs(x) + abs(y)) > 50_000:
        confidence = "high"

    source = (
        f"float32 triple at decompressed offset {best['offset']} "
        f"relative_to_actor_match={relative}"
    )

    return (x, y, z), confidence, source


def actor_name_regex(token: str) -> bytes:
    # This catches the normal actor reference:
    # Persistent_Level:PersistentLevel.Build_MinerMk2_C_2147112390
    return rb"Persistent_Level:PersistentLevel\.(" + re.escape(token.encode("utf-8")) + rb"_\d+)"

def parse_relative_offset_from_source(source: str | None) -> int | None:
    if not source:
        return None

    match = re.search(r"relative_to_actor_match=(-?\d+)", source)
    if not match:
        return None

    return int(match.group(1))


def passes_overlay_coordinate_sanity(actor: FoundActor) -> tuple[bool, list[str]]:
    """
    Conservative v0 filter.

    For now, we only trust normal miners where the transform-like float triple
    appears right after the actor reference. In this save, the clean miner hits
    are usually relative_to_actor_match=52.

    We intentionally do NOT trust oil/water/geothermal/resource-well yet because
    many of those are being recovered from nearby unrelated actors or neighboring
    pipeline/power objects.
    """
    reasons: list[str] = []

    if actor.x is None or actor.y is None or actor.z is None:
        reasons.append("missing coordinates")
        return False, reasons

    if actor.label not in {"Miner Mk.1", "Miner Mk.2", "Miner Mk.3"}:
        reasons.append("v0 overlay only trusts normal miners")
        return False, reasons

    relative_offset = parse_relative_offset_from_source(actor.coordinate_source)

    if relative_offset != 52:
        reasons.append(f"relative offset is {relative_offset}, expected 52")
        return False, reasons

    if abs(actor.x) < 1_000 and abs(actor.y) > 200_000:
        reasons.append("x is near zero while y is huge; likely wrong float triple")

    if abs(actor.y) < 1_000 and abs(actor.x) > 200_000:
        reasons.append("y is near zero while x is huge; likely wrong float triple")

    if abs(actor.z) > 30_000:
        reasons.append("z is outside conservative miner overlay range")

    if abs(actor.x) > PLAUSIBLE_XY_ABS_MAX or abs(actor.y) > PLAUSIBLE_XY_ABS_MAX:
        reasons.append("x/y outside plausible world range")

    return len(reasons) == 0, reasons


def build_overlay_candidates(actors: list[FoundActor]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for actor in actors:
        include, reject_reasons = passes_overlay_coordinate_sanity(actor)

        candidates.append({
            "actor_name": actor.actor_name,
            "label": actor.label,
            "x": actor.x,
            "y": actor.y,
            "z": actor.z,
            "coordinate_confidence": actor.coordinate_confidence,
            "coordinate_source": actor.coordinate_source,
            "relative_offset": parse_relative_offset_from_source(actor.coordinate_source),
            "include_in_v0_overlay": include,
            "reject_reasons": reject_reasons,
            "resource_type": None,
            "purity": None,
            "notes": "resource_type/purity not parsed yet",
        })

    return sorted(
        candidates,
        key=lambda item: (
            not item["include_in_v0_overlay"],
            item["label"],
            item["actor_name"],
        ),
    )


def scan_for_target_actors(blob: bytes, verbose: bool = False) -> tuple[list[FoundActor], dict[str, Any]]:
    best_by_actor_name: dict[str, FoundActor] = {}

    confidence_rank = {
        "none": 0,
        "low": 1,
        "medium": 2,
        "high": 3,
    }

    for label, token in TARGETS.items():
        regex = actor_name_regex(token)

        matches = list(re.finditer(regex, blob))
        if verbose:
            print(f"[debug] {label}: {len(matches)} raw actor-reference matches for {token}")

        for match in matches:
            actor_name = match.group(1).decode("utf-8", errors="replace")
            offset = match.start(1)

            coords, confidence, source = extract_nearby_coordinates(blob, offset)
            nearby_ascii = decode_nearby_ascii(blob, offset)
            possible_resource_reference = find_possible_resource_reference(nearby_ascii)

            actor = FoundActor(
                label=label,
                actor_name=actor_name,
                token=token,
                offset=offset,
                coordinate_confidence=confidence,
                coordinate_source=source,
                nearby_ascii=nearby_ascii,
                possible_resource_reference=possible_resource_reference,
            )

            if coords:
                actor.x = round(coords[0], 3)
                actor.y = round(coords[1], 3)
                actor.z = round(coords[2], 3)

            current = best_by_actor_name.get(actor_name)
            if current is None:
                best_by_actor_name[actor_name] = actor
                continue

            if confidence_rank[actor.coordinate_confidence] > confidence_rank[current.coordinate_confidence]:
                best_by_actor_name[actor_name] = actor

    actors = sorted(
        best_by_actor_name.values(),
        key=lambda item: (item.label, item.actor_name),
    )

    summary = {
        "total_unique_target_actors": len(actors),
        "actor_counts": dict(Counter(actor.label for actor in actors)),
        "coordinate_confidence_counts": dict(Counter(actor.coordinate_confidence for actor in actors)),
        "actors_with_coordinates": sum(1 for actor in actors if actor.x is not None),
    }

    return actors, summary


def count_reference_patterns(blob: bytes) -> dict[str, int]:
    counts: dict[str, int] = {}

    for label, pattern in REFERENCE_PATTERNS.items():
        # Bucket offsets so repeated class-path/name mentions do not explode the count as badly.
        buckets = {match.start() // 128 for match in re.finditer(re.escape(pattern), blob)}
        counts[label] = len(buckets)

    return counts


def extract_mod_names(mod_metadata_raw: str | None) -> list[str]:
    if not mod_metadata_raw:
        return []

    try:
        payload = json.loads(mod_metadata_raw)
    except Exception:
        return []

    mods = payload.get("Mods", [])
    names = []

    for mod in mods:
        if isinstance(mod, dict):
            names.append(mod.get("Name") or mod.get("Reference"))

    return sorted(name for name in names if name)


def build_report(save_path: Path, verbose: bool = False) -> dict[str, Any]:
    raw = save_path.read_bytes()

    header, compressed_start_offset = parse_header(raw, save_path)
    decompressed, chunk_reports = decompress_save_chunks(raw, compressed_start_offset, verbose=verbose)

    uncompressed_size_field = None
    if len(decompressed) >= 8:
        uncompressed_size_field = struct.unpack_from("<Q", decompressed, 0)[0]

    actors, actor_summary = scan_for_target_actors(decompressed, verbose=verbose)
    overlay_candidates = build_overlay_candidates(actors)
    overlay_summary = {
        "total_overlay_candidates": len(overlay_candidates),
        "included_in_v0_overlay": sum(1 for item in overlay_candidates if item["include_in_v0_overlay"]),
        "included_counts": dict(Counter(
            item["label"]
            for item in overlay_candidates
            if item["include_in_v0_overlay"]
        )),
    }



    return {
        "script": {
            "name": "tools/save-parser/inspect_save.py",
            "purpose": "diagnostic save-file overlay extractor",
            "notes": [
                "This is not a full polished save parser yet.",
                "Actor class/name and world coordinates are proven enough for v0 overlay debugging.",
                "Resource type/purity linking is not proven yet.",
                "possible_resource_reference is only a nearby text clue, not a verified mExtractableResource parse.",
            ],
        },
        "header": asdict(header),
        "mods_detected": extract_mod_names(header.mod_metadata_raw),
        "compressed_start_offset": compressed_start_offset,
        "decompression": {
            "input_bytes": len(raw),
            "chunk_count": len(chunk_reports),
            "decompressed_bytes": len(decompressed),
            "uncompressed_size_field": uncompressed_size_field,
            "chunk_reports_sample": chunk_reports[:10],
        },
        "reference_counts": count_reference_patterns(decompressed),
        "summary": actor_summary,
        "overlay_summary": overlay_summary,
        "overlay_candidates": overlay_candidates,
        "actors": [asdict(actor) for actor in actors],
    }


def print_report_summary(report: dict[str, Any]) -> None:
    header = report["header"]

    print()
    print("=== Save Header ===")
    print(f"Path: {safe_text(header.get('path'))}")
    print(f"File size: {header.get('file_size_bytes'):,} bytes")
    print(f"Save header version: {header.get('save_header_version')}")
    print(f"Save version: {header.get('save_version')}")
    print(f"Build version: {header.get('build_version')}")
    print(f"Save name: {safe_text(header.get('save_name'))}")
    print(f"Map name: {safe_text(header.get('map_name'))}")
    print(f"Session name: {safe_text(header.get('session_name'))}")
    print(f"Play duration seconds: {header.get('play_duration_seconds')}")
    print(f"Session visibility: {header.get('session_visibility')}")
    print(f"Editor object version: {header.get('editor_object_version')}")
    print(f"Modded save: {header.get('is_modded_save')}")
    print(f"Mods detected: {', '.join(report.get('mods_detected') or []) or 'None'}")
    print(f"Creative mode enabled: {header.get('is_creative_mode_enabled')}")

    print()
    print("=== Decompression ===")
    decomp = report["decompression"]
    print(f"Compressed start offset: {report['compressed_start_offset']}")
    print(f"Chunk count: {decomp['chunk_count']:,}")
    print(f"Input bytes: {decomp['input_bytes']:,}")
    print(f"Decompressed bytes: {decomp['decompressed_bytes']:,}")
    print(f"Uncompressed size field: {decomp['uncompressed_size_field']}")

    print()
    print("=== Reference Counts ===")
    for key, value in report["reference_counts"].items():
        print(f"{key}: {value}")

    print()
    print("=== Placed Target Actor Counts ===")
    actor_counts = report["summary"]["actor_counts"]
    if not actor_counts:
        print("No target miner/extractor/geothermal actors found.")
    else:
        for key, value in sorted(actor_counts.items()):
            print(f"{key}: {value}")

    print()
    print("=== Coordinate Confidence ===")
    confidence_counts = report["summary"]["coordinate_confidence_counts"]
    if not confidence_counts:
        print("No coordinate candidates found.")
    else:
        for key, value in sorted(confidence_counts.items()):
            print(f"{key}: {value}")

    print()
    print("=== V0 Overlay Candidates ===")
    overlay_summary = report.get("overlay_summary") or {}
    print(f"Total candidates checked: {overlay_summary.get('total_overlay_candidates')}")
    print(f"Included in v0 overlay: {overlay_summary.get('included_in_v0_overlay')}")

    included_counts = overlay_summary.get("included_counts") or {}
    if included_counts:
        for key, value in sorted(included_counts.items()):
            print(f"{key}: {value}")
    else:
        print("No actors passed the conservative v0 overlay filter.")

    print()
    print("=== Sample V0 Overlay Actors ===")
    overlay_candidates = report.get("overlay_candidates") or []
    included_overlay_candidates = [
        actor
        for actor in overlay_candidates
        if actor.get("include_in_v0_overlay")
    ]

    if not included_overlay_candidates:
        print("No v0 overlay actors to sample.")
    else:
        for actor in included_overlay_candidates[:15]:
            print(
                f"{actor['actor_name']} "
                f"({actor['label']}): "
                f"x={actor['x']}, y={actor['y']}, z={actor['z']} "
                f"[{actor['coordinate_confidence']}, relative_offset={actor['relative_offset']}]"
            )

    print()
    print("=== Sample Actors With Any Coordinates ===")
    actors_with_coords = [
        actor
        for actor in report["actors"]
        if actor.get("x") is not None
    ]

    if not actors_with_coords:
        print("No actor coordinates recovered yet.")
    else:
        for actor in actors_with_coords[:15]:
            print(
                f"{actor['actor_name']} "
                f"({actor['label']}): "
                f"x={actor['x']}, y={actor['y']}, z={actor['z']} "
                f"[{actor['coordinate_confidence']}]"
            )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect a Satisfactory .sav file for save-overlay diagnostics."
    )

    parser.add_argument(
        "save_file",
        type=Path,
        help="Path to a local .sav file. Do not commit this file.",
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"JSON debug output path. Default: {DEFAULT_OUTPUT_PATH}",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print readable debug messages. Never prints raw save bytes.",
    )

    parser.add_argument(
        "--no-json",
        action="store_true",
        help="Print summary only; do not write JSON.",
    )

    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    save_path = args.save_file

    if not save_path.exists():
        print(f"ERROR: Save file does not exist: {save_path}", file=sys.stderr)
        return 2

    if save_path.suffix.lower() != ".sav":
        print(f"WARNING: File does not end with .sav: {save_path}")

    try:
        report = build_report(save_path, verbose=args.verbose)
    except Exception as exc:
        print(f"ERROR: Failed to inspect save: {exc}", file=sys.stderr)
        return 1

    print_report_summary(report)

    if not args.no_json:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print()
        print(f"Wrote JSON debug output: {args.output}")

    print()
    print("Reminder: this is diagnostic output only. Resource type/purity linking is not proven yet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))