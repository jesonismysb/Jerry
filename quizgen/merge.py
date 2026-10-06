# -*- coding: utf-8 -*-
"""把 quizgen 目录下的 JSON 题库合并进 textbooks.html 对应章节。
用法: python merge.py            # 校验并合并所有已存在的 JSON
"""
import json, os, re, shutil, sys

ROOT = r'f:\personal-nav'
GEN = os.path.join(ROOT, 'quizgen')
HTML = os.path.join(ROOT, 'textbooks.html')

BOOKS = {  # 文件名前缀 -> (book id, 章节数)
    'phys': ('physiology', 12),
    'anat': ('anatomy', 12),
    'eng':  ('english', 8),
    'chn':  ('chinese', 8),
}

def validate(path):
    """校验单个题库 JSON，返回错误列表（空=通过）"""
    errs = []
    try:
        data = json.load(open(path, encoding='utf-8'))
    except Exception as e:
        return [f'JSON解析失败: {e}']
    if not isinstance(data, list):
        return ['顶层必须是数组']
    if len(data) != 50:
        errs.append(f'题量={len(data)}，应为50')
    tc = sum(1 for q in data if q.get('type') == 'choice')
    tj = sum(1 for q in data if q.get('type') == 'judge')
    if tc != 38 or tj != 12:
        errs.append(f'题型 单选{tc}/判断{tj}，应为38/12')
    db = sum(1 for q in data if q.get('difficulty') == 'base')
    dm = sum(1 for q in data if q.get('difficulty') == 'mid')
    dh = sum(1 for q in data if q.get('difficulty') == 'high')
    if (db, dm, dh) != (35, 10, 5):
        errs.append(f'难度 基础{db}/中档{dm}/拔高{dh}，应为35/10/5')
    seen = set()
    for i, q in enumerate(data):
        t = q.get('type'); d = q.get('difficulty')
        if t not in ('choice', 'judge'): errs.append(f'#{i} type非法: {t}')
        if d not in ('base', 'mid', 'high'): errs.append(f'#{i} difficulty非法: {d}')
        if not q.get('q'): errs.append(f'#{i} 缺题干')
        if not q.get('explain'): errs.append(f'#{i} 缺解析')
        if t == 'choice':
            opts = q.get('options')
            if not isinstance(opts, list) or len(opts) != 4:
                errs.append(f'#{i} 选项数!=4')
            if not isinstance(q.get('answer'), int) or not (0 <= q.get('answer', -1) <= 3):
                errs.append(f'#{i} 答案下标非法: {q.get("answer")}')
        if t == 'judge' and not isinstance(q.get('answer'), bool):
            errs.append(f'#{i} 判断题答案须为true/false')
        key = (q.get('q') or '').strip()
        if key in seen: errs.append(f'#{i} 题干重复: {key[:20]}')
        seen.add(key)
        for k in ('q', 'explain'):
            v = q.get(k) or ''
            if '"' in v: errs.append(f'#{i} {k}含英文双引号')
        if t == 'choice':
            for o in (q.get('options') or []):
                if '"' in o: errs.append(f'#{i} 选项含英文双引号')
    return errs

def find_book_span(text, book_id):
    m = re.search(r"\nid:\s*'%s'," % re.escape(book_id), text)
    if not m: raise RuntimeError('找不到书: ' + book_id)
    start = m.start()
    nxt = re.search(r"\n\s*\{\s*\n?\s*id:\s*'", text[m.end():])
    end = m.end() + nxt.start() if nxt else text.index('/* 预留', m.end())
    return start, end

def chapter_spans(block):
    """返回每个 chapter 的 (start,end,title)，按出现顺序；跳过书对象自身的 title"""
    ms = list(re.finditer(r"title:\s*'([^']+)'", block))
    ms = ms[1:]  # 第一个是书名
    spans = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(block)
        spans.append((m.start(), end, m.group(1)))
    return spans

def inject(ch_text, js):
    """把 questions 注入单个 chapter 文本块"""
    if 'questions: []' in ch_text:
        return ch_text.replace('questions: []', 'questions: ' + js, 1)
    if 'questions: [' in ch_text:
        s = ch_text.index('questions: [')
        close = ch_text.index('\n        ]', s)
        return ch_text[:s] + 'questions: ' + js + ch_text[close + len('\n        ]'):]
    # 无 questions 字段：在最后一个 practiceUrl: '' 后追加
    idx = ch_text.rindex("practiceUrl: ''")
    return ch_text[:idx] + "practiceUrl: '', questions: " + js + ch_text[idx + len("practiceUrl: ''"):]

def main():
    text = open(HTML, encoding='utf-8').read()
    total_ok = total_skip = total_err = 0
    for prefix, (book_id, nch) in BOOKS.items():
        try:
            bs, be = find_book_span(text, book_id)
        except RuntimeError as e:
            print(e); total_err += 1; continue
        block = text[bs:be]
        spans = chapter_spans(block)
        if len(spans) != nch:
            print(f'[{prefix}] 章节数={len(spans)} 应为{nch}，跳过'); total_err += 1; continue
        for i, (cs, ce, title) in enumerate(spans):
            fp = os.path.join(GEN, f'{prefix}-{i}.json')
            if not os.path.exists(fp):
                continue
            errs = validate(fp)
            if errs:
                total_err += 1
                print(f'[FAIL] {prefix}-{i} {title}')
                for e in errs[:8]: print('   -', e)
                continue
            data = json.load(open(fp, encoding='utf-8'))
            js = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
            js = js.replace('</', '<\\/')  # 防止 </script> 截断
            new_ch = inject(block[cs:ce], js)
            block = block[:cs] + new_ch + block[ce:]
            total_ok += 1
            print(f'[OK] {prefix}-{i} {title} <- {len(data)}题')
        text = text[:bs] + block + text[be:]
    if total_ok == 0 and total_err == 0:
        print('没有发现可合并的 JSON 文件'); return
    if total_err:
        print(f'\n有 {total_err} 个文件校验失败，仅合并了 {total_ok} 个。未写入文件。')
        sys.exit(1)
    shutil.copy(HTML, HTML + '.bak')
    open(HTML, 'w', encoding='utf-8', newline='\n').write(text)
    print(f'\n合并完成：{total_ok} 个章节题库已写入 textbooks.html（备份 textbooks.html.bak）')

if __name__ == '__main__':
    main()
