"""Count observed message-ID reuse offline without printing device or customer values."""
import argparse
import collections
import hashlib
import json
import zipfile

OPERATIONS = {'AddClock', 'CheckHandCode', 'CheckJSCode', 'CloseClock', 'ReportClock'}


def inspect(archive):
    decoder = json.JSONDecoder()
    requests = collections.Counter()
    ids = collections.defaultdict(set)
    repeats = collections.Counter()
    scoped_repeats = collections.Counter()
    global_seen = {}
    scoped_seen = {}
    with zipfile.ZipFile(archive) as bundle:
        entries = [name for name in bundle.namelist()
                   if '/Commlog.' in name and name.endswith('.txt')]
        for entry in entries:
            day = entry.rsplit('Commlog.', 1)[-1].removesuffix('.txt')
            with bundle.open(entry) as log:
                for raw in log:
                    line = raw.decode('utf-8', 'replace')
                    marker = ' request {'
                    if marker not in line:
                        continue
                    try:
                        request, _ = decoder.raw_decode(
                            line[line.index(marker)+len(' request '):])
                    except (ValueError, TypeError):
                        continue
                    operation = request.get('url')
                    if operation not in OPERATIONS:
                        continue
                    head = request.get('head')
                    if not isinstance(head, dict):
                        continue
                    message_id = head.get('MSG_ID')
                    if not isinstance(message_id, str) or not message_id:
                        continue
                    requests[operation] += 1
                    ids[operation].add(message_id)
                    body = hashlib.sha256(str(request.get('body')).encode()).digest()
                    global_key = (operation, message_id)
                    scoped_key = (day, operation, head.get('devid'),
                                  head.get('roomid'), message_id)
                    for key, seen, counts in ((global_key, global_seen, repeats),
                                              (scoped_key, scoped_seen, scoped_repeats)):
                        if key in seen:
                            counts[(operation, 'same' if seen[key] == body else 'changed')] += 1
                        else:
                            seen[key] = body
    return {'files': len(entries), 'operations': {
        operation: {
            'requests': requests[operation],
            'distinct_message_ids': len(ids[operation]),
            'global_repeats_same_body': repeats[(operation, 'same')],
            'global_repeats_changed_body': repeats[(operation, 'changed')],
            'same_day_device_room_repeats': sum(scoped_repeats[(operation, kind)]
                                                for kind in ('same', 'changed')),
        } for operation in sorted(OPERATIONS)
    }}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', help='User-supplied Hardware ZIP')
    args = parser.parse_args()
    print(json.dumps(inspect(args.archive), ensure_ascii=False, indent=2))
