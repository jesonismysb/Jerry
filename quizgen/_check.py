import json
for f in [r'f:\personal-nav\quizgen\eng-6.json', r'f:\personal-nav\quizgen\eng-7.json']:
    data = json.load(open(f, encoding='utf-8'))
    total = len(data)
    choice = sum(1 for x in data if x['type']=='choice')
    judge = sum(1 for x in data if x['type']=='judge')
    base = sum(1 for x in data if x['difficulty']=='base')
    mid = sum(1 for x in data if x['difficulty']=='mid')
    high = sum(1 for x in data if x['difficulty']=='high')
    ans_dist = [0,0,0,0]
    for x in data:
        if x['type']=='choice':
            ans_dist[x['answer']] += 1
    judge_t = sum(1 for x in data if x['type']=='judge' and x['answer']==True)
    judge_f = sum(1 for x in data if x['type']=='judge' and x['answer']==False)
    bad = []
    for i, x in enumerate(data):
        fields = [x.get('q',''), x.get('explain','')] + x.get('options',[])
        for fld in fields:
            if '"' in fld: bad.append(('quote', i, fld[:50]))
            if '[' in fld or ']' in fld: bad.append(('bracket', i, fld[:50]))
            if '<' in fld or '>' in fld: bad.append(('angle', i, fld[:50]))
            if '\n' in fld or '\r' in fld: bad.append(('newline', i, fld[:50]))
    print(f, 'total=%d choice=%d judge=%d base=%d mid=%d high=%d ans=%s judgeT=%d judgeF=%d' % (total, choice, judge, base, mid, high, ans_dist, judge_t, judge_f))
    if bad:
        print('  BAD:', bad[:20])
