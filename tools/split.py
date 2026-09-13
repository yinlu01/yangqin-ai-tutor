#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从唯一源 prototype/server/public/index.html 派生 teacher.html / student.html。
补丁数据在同目录 split_teacher.json / split_student.json（角色专属差异）。

用法：
  python3 yangqin-ai-tutor/tools/split.py
输出：
  prototype/server/public/teacher.html, student.html
说明：
  补丁里的 300~1700 行区间属"通用逻辑"，不参与派生（那段是 index 的单一真源）。
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'prototype', 'server', 'public')


def find_seq(lines, seq, start=0):
    """在 lines 中查找子序列 seq，返回起始下标；找不到返回 -1"""
    if not seq:
        return start
    n, m = len(lines), len(seq)
    for i in range(start, n - m + 1):
        if lines[i:i + m] == seq:
            return i
    return -1


def apply_patches(src_lines, patches, name):
    out = list(src_lines)
    applied, skipped = 0, []
    for p in patches:
        new = p['new']
        # 已经应用过（内容已存在）→ 跳过，保证可重复执行
        if new and find_seq(out, new) >= 0:
            skipped.append('already: ' + (new[0][:50] if new[0].strip() else new[1][:50]))
            continue
        target = p['before'] + p['old'] + p['after']
        idx = find_seq(out, target)
        if idx < 0:
            # 退化：只用 before 锚点定位
            idx = find_seq(out, p['before'])
            if idx < 0:
                skipped.append('NO-ANCHOR: ' + (p['old'] or new or [''])[0][:50])
                continue
            idx += len(p['before'])
            out[idx:idx] = new
            applied += 1
            continue
        rep = p['before'] + new + p['after']
        out[idx:idx + len(target)] = rep
        applied += 1
    print('%-8s applied=%d skipped=%d' % (name, applied, len(skipped)))
    for s in skipped:
        print('         skip:', s)
    return out


def main():
    src = os.path.join(PUB, 'index.html')
    lines = io.open(src, encoding='utf-8').read().split('\n')
    for role in ('teacher', 'student'):
        pf = os.path.join(HERE, 'split_%s.json' % role)
        patches = json.load(io.open(pf, encoding='utf-8'))
        out = apply_patches(lines, patches, role)
        dst = os.path.join(PUB, '%s.html' % role)
        io.open(dst, 'w', encoding='utf-8').write('\n'.join(out))
        print('         ->', os.path.relpath(dst, HERE), len(out), 'lines')
    return 0


if __name__ == '__main__':
    sys.exit(main())
