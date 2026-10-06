import json, sys
from collections import Counter
path = sys.argv[1]
d = json.load(open(path, encoding='utf-8'))
print(path)
print('total', len(d))
print('type', Counter(x['type'] for x in d))
print('diff', Counter(x['difficulty'] for x in d))
print('choice answers', Counter(x['answer'] for x in d if x['type'] == 'choice'))
print('judge answers', Counter(str(x['answer']) for x in d if x['type'] == 'judge'))
bad = 0
for i, x in enumerate(d):
    for k, v in x.items():
        vals = v if isinstance(v, list) else [v]
        for it in vals:
            if isinstance(it, str):
                for ch in ['[', ']', '<', '>', '"', '\n', '\r']:
                    if ch in it:
                        print('BAD char', repr(ch), 'item', i, 'key', k, ':', it[:60])
                        bad += 1
print('bad', bad)
