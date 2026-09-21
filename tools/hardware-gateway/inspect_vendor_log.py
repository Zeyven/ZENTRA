"""Inspect supplied ZIP logs offline. Output structural metadata, never field values.

Does not execute vendor binaries or contact a network service.
"""
import argparse
import base64
import collections
import json
import zipfile

FIELD_NAMES = {'data', 'id', 'bh', 'mc', 'pgid', 'funid', 'c', 'lbbh', 'xxbh', 'xxbz', 'xxmc'}
INTERFACES = {'CheckHandCode', 'CheckJSCode', 'CloseClock', 'GetTecQueryList',
              'HeadBeat', 'ReportClock', 'SystemClockInfo', 'SystemDeviceLogin',
              'SystemUserLogin', 'conn', 'GetItemInfo', 'GetRoomTec', 'AddClock',
              'GetWaitRoom', 'GetItemGradeInfo', 'GetCallServerInfo'}


def shape(value, depth=0):
    if depth > 8:
        return 'depth-limit'
    if isinstance(value, dict):
        # Even alphabetic dynamic keys may contain account names.
        return {key if key in FIELD_NAMES else '<other-field>': shape(child, depth+1)
                for key, child in value.items()}
    if isinstance(value, list):
        return {'array': sorted({json.dumps(shape(child, depth+1), sort_keys=True) for child in value})}
    if value is None:
        return 'null'
    return type(value).__name__


def inspect(archive, entry):
    counts = collections.Counter()
    structures = collections.defaultdict(set)
    decoder = json.JSONDecoder()
    malformed = 0
    with zipfile.ZipFile(archive) as bundle, bundle.open(entry) as log:
        for raw in log:
            # Request JSON contains a complete base64 representation even if the
            # later human-readable GetBody() text spans many lines.
            text = raw.decode('utf-8', 'replace')
            marker = ' request {'
            if marker not in text:
                continue
            try:
                request, _ = decoder.raw_decode(text[text.index(marker)+len(' request '):])
                name = request.get('url', '')
                if name not in INTERFACES:
                    name = '<unknown-interface>'
                counts[name] += 1
                encoded = request.get('body')
                if encoded is None:
                    value = None
                else:
                    decoded = base64.b64decode(encoded, validate=True)
                    try:
                        value = json.loads(decoded)
                    except (ValueError, UnicodeDecodeError):
                        value = '<non-json>'
                structures[name].add(json.dumps(shape(value), sort_keys=True))
            except (ValueError, TypeError, KeyError):
                malformed += 1
    return {'requests': dict(sorted(counts.items())),
            'request_body_shapes': {name: [json.loads(s) for s in sorted(values)] for name, values in sorted(structures.items())},
            'unparsed_request_records': malformed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--entry', default='Hardware/log/Commlog.2026-09-13.txt')
    args = parser.parse_args()
    print(json.dumps(inspect(args.archive, args.entry), ensure_ascii=False, indent=2))
