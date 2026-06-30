#!/usr/bin/env python3
"""
cursor_claude_amazon_app.md → Kindle判型 (210×257mm) docx 変換スクリプト
"""
import re
import sys
from pathlib import Path

from docx import Document
from docx.shared import Mm, Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


def set_page_size(doc: Document, width_mm: float, height_mm: float,
                  margin_top=15, margin_bottom=15, margin_inner=18, margin_outer=12):
    """Kindle 判型に合わせたページ設定"""
    section = doc.sections[0]
    section.page_width  = Mm(width_mm)
    section.page_height = Mm(height_mm)
    section.top_margin    = Mm(margin_top)
    section.bottom_margin = Mm(margin_bottom)
    section.left_margin   = Mm(margin_inner)
    section.right_margin  = Mm(margin_outer)


def setup_styles(doc: Document):
    """ドキュメント共通スタイルの設定"""
    styles = doc.styles

    # 本文（Normal）
    normal = styles["Normal"]
    nf = normal.font
    nf.name = "Noto Sans CJK JP"
    nf.size = Pt(10)
    nf.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
    normal.paragraph_format.space_after  = Pt(6)
    normal.paragraph_format.line_spacing = Pt(16)

    # 見出し H1
    h1 = styles["Heading 1"]
    h1.font.name  = "Noto Sans CJK JP"
    h1.font.size  = Pt(18)
    h1.font.bold  = True
    h1.font.color.rgb = RGBColor(0x1A, 0x4A, 0x8A)
    h1.paragraph_format.space_before = Pt(24)
    h1.paragraph_format.space_after  = Pt(10)
    h1.paragraph_format.keep_with_next = True

    # 見出し H2
    h2 = styles["Heading 2"]
    h2.font.name  = "Noto Sans CJK JP"
    h2.font.size  = Pt(14)
    h2.font.bold  = True
    h2.font.color.rgb = RGBColor(0x2C, 0x5F, 0xA8)
    h2.paragraph_format.space_before = Pt(18)
    h2.paragraph_format.space_after  = Pt(6)
    h2.paragraph_format.keep_with_next = True

    # 見出し H3
    h3 = styles["Heading 3"]
    h3.font.name  = "Noto Sans CJK JP"
    h3.font.size  = Pt(11.5)
    h3.font.bold  = True
    h3.font.color.rgb = RGBColor(0x3C, 0x6A, 0xB8)
    h3.paragraph_format.space_before = Pt(12)
    h3.paragraph_format.space_after  = Pt(4)
    h3.paragraph_format.keep_with_next = True

    # 見出し H4
    h4 = styles["Heading 4"]
    h4.font.name  = "Noto Sans CJK JP"
    h4.font.size  = Pt(10.5)
    h4.font.bold  = True
    h4.font.italic = False
    h4.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
    h4.paragraph_format.space_before = Pt(10)
    h4.paragraph_format.space_after  = Pt(3)
    h4.paragraph_format.keep_with_next = True

    # コードブロック用スタイルを追加
    if "Code Block" not in [s.name for s in styles]:
        code_style = styles.add_style("Code Block", WD_STYLE_TYPE.PARAGRAPH)
        code_style.base_style = styles["Normal"]
        cf = code_style.font
        cf.name  = "Courier New"
        cf.size  = Pt(7.5)
        cf.color.rgb = RGBColor(0x1E, 0x1E, 0x2E)
        pf = code_style.paragraph_format
        pf.space_before = Pt(4)
        pf.space_after  = Pt(4)
        pf.left_indent  = Mm(4)
        pf.line_spacing = Pt(11)

    # 注釈（> blockquote）用
    if "Block Quote" not in [s.name for s in styles]:
        bq_style = styles.add_style("Block Quote", WD_STYLE_TYPE.PARAGRAPH)
        bq_style.base_style = styles["Normal"]
        bq_style.font.italic = True
        bq_style.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
        bq_style.paragraph_format.left_indent = Mm(6)
        bq_style.paragraph_format.space_before = Pt(6)
        bq_style.paragraph_format.space_after  = Pt(6)

    # 箇条書き
    if "List Bullet" not in [s.name for s in styles]:
        lb_style = styles.add_style("List Bullet", WD_STYLE_TYPE.PARAGRAPH)
        lb_style.base_style = styles["Normal"]
        lb_style.paragraph_format.left_indent = Mm(6)
        lb_style.paragraph_format.space_after  = Pt(3)


def add_code_block_border(para):
    """コードブロック段落に薄い背景色（灰色）を付ける"""
    pPr = para._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F3F4F6")
    pPr.append(shd)


def parse_inline(run_parent, text: str, doc: Document):
    """インラインマークアップ（**太字**, `コード`, _斜体_）を処理してRunを追加"""
    # パターン: **bold**, `code`, _italic_
    pattern = re.compile(r'(\*\*(.+?)\*\*|`(.+?)`|_(.+?)_)')
    pos = 0
    for m in pattern.finditer(text):
        start, end = m.start(), m.end()
        # プレーンテキスト
        if start > pos:
            run = run_parent.add_run(text[pos:start])
            run.font.name = "Noto Sans CJK JP"
        full = m.group(0)
        if full.startswith("**"):
            r = run_parent.add_run(m.group(2))
            r.bold = True
            r.font.name = "Noto Sans CJK JP"
        elif full.startswith("`"):
            r = run_parent.add_run(m.group(3))
            r.font.name  = "Courier New"
            r.font.size  = Pt(8.5)
            r.font.color.rgb = RGBColor(0xC7, 0x25, 0x4A)
        else:
            r = run_parent.add_run(m.group(4))
            r.italic = True
            r.font.name = "Noto Sans CJK JP"
        pos = end
    if pos < len(text):
        run = run_parent.add_run(text[pos:])
        run.font.name = "Noto Sans CJK JP"


def build_table(doc: Document, lines: list[str]):
    """Markdownのテーブルをdocxテーブルに変換"""
    rows = []
    for line in lines:
        if re.match(r'^\|[-| :]+\|$', line.strip()):
            continue  # 区切り行スキップ
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)

    if not rows:
        return

    ncols = max(len(r) for r in rows)
    tbl = doc.add_table(rows=len(rows), cols=ncols)
    tbl.style = "Table Grid"

    # カラム幅（均等）
    col_width = Mm(170 / ncols)
    for col in tbl.columns:
        for cell in col.cells:
            cell.width = col_width

    for ri, row_data in enumerate(rows):
        row = tbl.rows[ri]
        for ci, cell_text in enumerate(row_data):
            if ci >= ncols:
                break
            cell = row.cells[ci]
            p = cell.paragraphs[0]
            if ri == 0:
                run = p.add_run(cell_text)
                run.bold = True
                run.font.name = "Noto Sans CJK JP"
                run.font.size = Pt(8.5)
            else:
                p.clear()
                parse_inline(p, cell_text, doc)
                for run in p.runs:
                    run.font.size = Pt(8.5)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after  = Pt(2)

    doc.add_paragraph()  # テーブル後の余白


def convert_md_to_docx(md_path: Path, docx_path: Path):
    doc = Document()

    # ページ設定（Kindle: 210×257mm）
    set_page_size(doc, width_mm=210, height_mm=257)
    setup_styles(doc)

    lines = md_path.read_text(encoding="utf-8").splitlines()

    i = 0
    in_code_block = False
    code_lang = ""
    code_lines: list[str] = []
    table_lines: list[str] = []
    in_table = False

    while i < len(lines):
        line = lines[i]

        # ========== コードブロック ==========
        if line.startswith("```"):
            if not in_code_block:
                in_code_block = True
                code_lang = line[3:].strip()
                code_lines = []
            else:
                # コードブロック終了
                in_code_block = False
                lang_label = f"[{code_lang}]" if code_lang else ""
                if lang_label:
                    lp = doc.add_paragraph(lang_label)
                    lp.style = "Normal"
                    for run in lp.runs:
                        run.font.size = Pt(7)
                        run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
                        run.font.name = "Courier New"
                    lp.paragraph_format.space_after = Pt(1)

                for j, cl in enumerate(code_lines):
                    cp = doc.add_paragraph(cl if cl else " ")
                    cp.style = "Code Block"
                    add_code_block_border(cp)
                    if j == 0:
                        cp.paragraph_format.space_before = Pt(4)
                    if j == len(code_lines) - 1:
                        cp.paragraph_format.space_after = Pt(6)
                    else:
                        cp.paragraph_format.space_after = Pt(0)
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        # ========== テーブル ==========
        if line.startswith("|"):
            table_lines.append(line)
            i += 1
            # テーブル終端
            if i >= len(lines) or not lines[i].startswith("|"):
                build_table(doc, table_lines)
                table_lines = []
            continue

        # ========== 見出し ==========
        m = re.match(r'^(#{1,4})\s+(.*)', line)
        if m:
            level = len(m.group(1))
            text  = m.group(2).strip()
            # Markdownリンク除去 [text](#anchor)
            text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
            style_map = {1: "Heading 1", 2: "Heading 2", 3: "Heading 3", 4: "Heading 4"}
            p = doc.add_paragraph(text, style=style_map.get(level, "Heading 4"))
            i += 1
            continue

        # ========== 水平線 ---  ==========
        if re.match(r'^---+\s*$', line):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after  = Pt(4)
            # 罫線追加
            pPr = p._p.get_or_add_pPr()
            pBdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "4")
            bottom.set(qn("w:space"), "1")
            bottom.set(qn("w:color"), "CCCCCC")
            pBdr.append(bottom)
            pPr.append(pBdr)
            i += 1
            continue

        # ========== 引用 > ==========
        if line.startswith("> "):
            text = line[2:].strip()
            p = doc.add_paragraph(style="Block Quote")
            parse_inline(p, text, doc)
            i += 1
            continue

        # ========== 箇条書き - / * ==========
        m_li = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)', line)
        if m_li:
            indent = len(m_li.group(1))
            text   = m_li.group(3)
            p = doc.add_paragraph(style="List Bullet")
            p.paragraph_format.left_indent = Mm(6 + indent * 3)
            # 記号を先頭に追加
            is_numbered = re.match(r'\d+\.', m_li.group(2))
            prefix = m_li.group(2) + " " if is_numbered else "• "
            run0 = p.add_run(prefix)
            run0.font.name = "Noto Sans CJK JP"
            parse_inline(p, text, doc)
            i += 1
            continue

        # ========== 空行 ==========
        if line.strip() == "":
            i += 1
            continue

        # ========== 通常段落 ==========
        p = doc.add_paragraph(style="Normal")
        parse_inline(p, line.strip(), doc)
        i += 1

    # 表紙ページ（先頭に挿入）
    # ※ python-docx では先頭挿入が難しいため最後に追加してから移動は省略
    # → 簡易対応: セクション区切りを先頭に追加する代わりに、
    #   最初の H1 が表紙相当なのでそのまま出力

    doc.save(str(docx_path))
    print(f"✅ 保存完了: {docx_path}")
    print(f"   ページサイズ: 210×257mm (Kindle)")
    print(f"   段落数: {len(doc.paragraphs)}")


if __name__ == "__main__":
    root = Path(__file__).parent
    md_path   = root / "cursor_claude_amazon_app.md"
    docx_path = root / "cursor_claude_amazon_app.docx"
    convert_md_to_docx(md_path, docx_path)
