#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
インデックス生成スクリプト
HTML/Q&Aファイルをスキャンしてマッピングを構築
GitHub Pages用にファイルをコピー
"""

import os
import re
import json
import shutil
import unicodedata
from pathlib import Path
from html.parser import HTMLParser

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

BASE_DIR = Path(__file__).parent.parent.parent
HTML_DIR = BASE_DIR / "出力したPDF"
QA_DIR = BASE_DIR / "Q&A"
APP_DIR = Path(__file__).parent.parent
OUTPUT_FILE = APP_DIR / "js" / "data.js"
EXCEL_FILE = BASE_DIR / "歯科国試データベース.xlsx"

# GitHub Pages用のコピー先
DEST_HTML_DIR = APP_DIR / "html"
DEST_QA_DIR = APP_DIR / "qa"

# 科目マスター（Excelがない場合のフォールバック）
SUBJECT_MASTER = [
    {"subject_id": "B01", "subject_name": "解剖学", "category": "基礎", "keywords": "解剖,骨,筋,神経,血管,頭頸部,舌,咽頭,頬,口蓋,顎骨,下顎,上顎,咬筋,側頭筋,三叉神経,顔面神経"},
    {"subject_id": "B02", "subject_name": "組織学", "category": "基礎", "keywords": "組織,細胞,発生,歯の発生,エナメル,象牙,歯髄,セメント質,歯根膜,エナメル芽細胞,象牙芽細胞,歯胚,鐘状期"},
    {"subject_id": "B03", "subject_name": "生理学", "category": "基礎", "keywords": "生理,機能,唾液,咀嚼,嚥下,味覚,反射,興奮,伝導,収縮,分泌,唾液腺,耳下腺,顎下腺,舌下腺"},
    {"subject_id": "B04", "subject_name": "生化学", "category": "基礎", "keywords": "生化学,代謝,酵素,タンパク,アミノ酸,糖,脂質,ATP,DNA,RNA,コラーゲン"},
    {"subject_id": "B05", "subject_name": "病理学", "category": "基礎", "keywords": "病理,腫瘍,炎症,嚢胞,肉芽,壊死,膿瘍,潰瘍,過形成,異形成,癌,肉腫,良性,悪性,転移,浸潤"},
    {"subject_id": "B06", "subject_name": "薬理学", "category": "基礎", "keywords": "薬理,薬物,投与,副作用,薬剤,禁忌,アドレナリン,リドカイン,抗菌薬,鎮痛,NSAIDs,ステロイド"},
    {"subject_id": "B07", "subject_name": "微生物・免疫", "category": "基礎", "keywords": "微生物,細菌,ウイルス,免疫,感染,抗体,抗原,リンパ,グラム,培養,消毒,滅菌,IgG,IgA,T細胞,B細胞"},
    {"subject_id": "B08", "subject_name": "理工学", "category": "基礎", "keywords": "材料,理工,物性,接着,器械,セメント,レジン,金属,セラミック,印象材,石膏,ワックス,鋳造,研磨"},
    {"subject_id": "B09", "subject_name": "衛生学", "category": "基礎", "keywords": "衛生,予防,疫学,統計,法規,保健,フッ化物,DMF,CPI,WHO,医療法,歯科医師法,介護保険,産業保健,労働"},
    {"subject_id": "C01", "subject_name": "小児歯科", "category": "臨床", "keywords": "小児,乳歯,萌出,成長発育,乳歯列,混合歯列,小児患者,男児,女児,歳,生後,永久歯萌出,既製冠,保隙"},
    {"subject_id": "C02", "subject_name": "矯正歯科", "category": "臨床", "keywords": "矯正,不正咬合,装置,セファロ,反対咬合,上顎前突,下顎前突,開咬,過蓋咬合,叢生,ブラケット,ワイヤー,アクチバトール,バイオネーター"},
    {"subject_id": "C03", "subject_name": "保存修復", "category": "臨床", "keywords": "修復,充填,インレー,CR,窩洞,コンポジットレジン,齲蝕,う蝕,齲窩,窩壁,裏層,接着,エッチング,ボンディング"},
    {"subject_id": "C04", "subject_name": "歯内療法", "category": "臨床", "keywords": "エンド,根管,歯髄,根尖,根管治療,根管充填,歯髄炎,根尖性歯周炎,感染根管,抜髄,根管拡大,ガッタパーチャ"},
    {"subject_id": "C05", "subject_name": "歯周病学", "category": "臨床", "keywords": "ペリオ,歯周,歯肉,プラーク,SRP,歯周ポケット,ポケット,動揺,歯槽骨,歯肉炎,歯周炎,スケーリング,ルートプレーニング,フラップ,GTR,エムドゲイン"},
    {"subject_id": "C06", "subject_name": "クラウンブリッジ", "category": "臨床", "keywords": "クラウン,ブリッジ,支台,印象,咬合,支台歯,支台築造,ポンティック,連結,適合,マージン,フィニッシュライン,プロビジョナル"},
    {"subject_id": "C07", "subject_name": "部分床義歯", "category": "臨床", "keywords": "パーシャル,部分床,クラスプ,義歯,部分床義歯,鉤,レスト,大連結子,小連結子,維持,把持,支持,サベイング"},
    {"subject_id": "C08", "subject_name": "全部床義歯", "category": "臨床", "keywords": "全部床,総義歯,無歯顎,人工歯,全部床義歯,義歯床,咬合堤,咬合採得,ゴシックアーチ,排列,リライン,リベース"},
    {"subject_id": "C09", "subject_name": "インプラント", "category": "臨床", "keywords": "インプラント,フィクスチャー,オッセオ,オッセオインテグレーション,上部構造,アバットメント,骨造成,サイナスリフト,GBR"},
    {"subject_id": "C10", "subject_name": "口腔外科", "category": "臨床", "keywords": "外科,抜歯,腫瘍,外傷,顎関節,骨折,嚢胞,膿瘍,蜂窩織炎,切開,縫合,止血,顎変形,唇顎口蓋裂"},
    {"subject_id": "C11", "subject_name": "放射線", "category": "臨床", "keywords": "放射線,X線,CT,画像,パノラマ,エックス線,MRI,造影,被曝,防護,デンタル,咬翼法,CBCT"},
    {"subject_id": "C12", "subject_name": "歯科麻酔", "category": "臨床", "keywords": "麻酔,鎮静,全身管理,モニタリング,局所麻酔,伝達麻酔,浸潤麻酔,笑気,静脈内鎮静,バイタルサイン,救急,ショック"},
    {"subject_id": "C13", "subject_name": "高齢者歯科", "category": "臨床", "keywords": "高齢者,摂食嚥下,介護,訪問,口腔ケア,誤嚥,誤嚥性肺炎,要介護,認知症,フレイル,サルコペニア,在宅"},
    {"subject_id": "A01", "subject_name": "必修", "category": "必修", "keywords": ""},
]


def load_subject_master():
    """Excelから科目マスターを読み込む（なければフォールバック）"""
    if HAS_PANDAS and EXCEL_FILE.exists():
        try:
            df = pd.read_excel(EXCEL_FILE, sheet_name='subject_master')
            subjects = []
            for _, row in df.iterrows():
                subjects.append({
                    "subject_id": row['subject_code'],
                    "subject_name": row['subject_name'],
                    "category": row['category'],
                    "keywords": row['keywords'] if pd.notna(row['keywords']) else ""
                })
            print(f"Loaded {len(subjects)} subjects from Excel")
            return subjects
        except Exception as e:
            print(f"Failed to load subject_master from Excel: {e}")
    return SUBJECT_MASTER


def classify_subject(title, search_text, subjects):
    """タイトルと検索テキストから科目を判定"""
    text = (title + ' ' + search_text).lower()

    best_match = None
    best_score = 0

    for subj in subjects:
        if not subj['keywords']:
            continue
        keywords = subj['keywords'].split(',')
        score = 0
        for kw in keywords:
            kw = kw.strip().lower()
            if kw and kw in text:
                # タイトルに含まれる場合は高スコア
                if kw in title.lower():
                    score += 3
                else:
                    score += 1

        if score > best_score:
            best_score = score
            best_match = subj

    if best_match and best_score >= 2:
        return best_match['subject_name'], best_match['category']

    return "その他", "その他"


class HTMLTextExtractor(HTMLParser):
    """HTMLからテキストを抽出"""
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip_tags = {'script', 'style', 'head'}
        self.current_tag = None

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag

    def handle_endtag(self, tag):
        self.current_tag = None

    def handle_data(self, data):
        if self.current_tag not in self.skip_tags:
            self.text.append(data.strip())

    def get_text(self):
        return ' '.join(filter(None, self.text))


def extract_html_text(filepath):
    """HTMLファイルからテキストを抽出"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        parser = HTMLTextExtractor()
        parser.feed(content)
        return parser.get_text()[:2000]
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return ""


def normalize_name(filename):
    """ファイル名を正規化してマッチング用のキーを生成"""
    # macOSのNFD対策: NFC正規化
    name = unicodedata.normalize('NFC', Path(filename).stem)
    # 順序重要: _QA を先に削除してから _国試対策まとめ を削除
    patterns = [
        r'_QA$',
        r'_国試対策まとめ$',
        r'_国試分析.*$',
        r'_v\d+$',
        r' \d+$',
    ]
    for pattern in patterns:
        name = re.sub(pattern, '', name)
    name = re.sub(r'^[ア-ン]_', '', name)
    name = re.sub(r'^[A-Z]_', '', name)
    return name


def safe_filename(filename):
    """ファイル名を安全な形式に変換"""
    name = filename.replace(' ', '_')
    return name


def find_html_files():
    """HTMLファイルを再帰的に検索"""
    html_files = {}
    for root, dirs, files in os.walk(HTML_DIR):
        for file in files:
            if file.endswith('.html') and not file.startswith('.'):
                filepath = Path(root) / file
                key = normalize_name(file)
                rel_path = filepath.relative_to(BASE_DIR)
                parts = rel_path.parts
                if len(parts) > 2:
                    category = '/'.join(parts[1:-1])
                else:
                    category = "その他"
                html_files[key] = {
                    'path': str(rel_path),
                    'filename': file,
                    'category': category,
                    'fullpath': filepath
                }
    return html_files


def find_qa_files():
    """Q&Aファイルを検索"""
    qa_files = {}
    for file in QA_DIR.iterdir():
        if file.suffix == '.txt' and file.name.endswith('_QA.txt'):
            key = normalize_name(file.name)
            rel_path = file.relative_to(BASE_DIR)
            qa_files[key] = {
                'path': str(rel_path),
                'filename': file.name,
                'fullpath': file
            }
    return qa_files


def read_qa_content(filepath):
    """Q&Aファイルの内容を読み込み"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()[:3000]
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return ""


def copy_files(html_files, qa_files):
    """ファイルをコピー"""
    # ディレクトリをクリア
    if DEST_HTML_DIR.exists():
        shutil.rmtree(DEST_HTML_DIR)
    if DEST_QA_DIR.exists():
        shutil.rmtree(DEST_QA_DIR)

    DEST_HTML_DIR.mkdir(parents=True, exist_ok=True)
    DEST_QA_DIR.mkdir(parents=True, exist_ok=True)

    # HTMLをコピー
    html_mapping = {}
    for key, info in html_files.items():
        dest_name = safe_filename(info['filename'])
        dest_path = DEST_HTML_DIR / dest_name
        shutil.copy2(info['fullpath'], dest_path)
        html_mapping[key] = f"html/{dest_name}"

    # Q&Aをコピー
    qa_mapping = {}
    for key, info in qa_files.items():
        dest_name = safe_filename(info['filename'])
        dest_path = DEST_QA_DIR / dest_name
        shutil.copy2(info['fullpath'], dest_path)
        qa_mapping[key] = f"qa/{dest_name}"

    return html_mapping, qa_mapping


def build_index(html_files, qa_files, html_mapping, qa_mapping, subjects):
    """インデックスを構築"""
    items = []
    matched_qa = set()

    for key, html_info in html_files.items():
        qa_info = qa_files.get(key)

        title = Path(html_info['filename']).stem.replace('_国試対策まとめ', '').replace('_国試分析', '')

        item = {
            'id': key.lower().replace(' ', '-'),
            'title': title,
            'category': html_info['category'],
            'htmlPath': html_mapping.get(key),
            'qaPath': qa_mapping.get(key) if qa_info else None,
            'searchText': ''
        }

        html_text = extract_html_text(html_info['fullpath'])
        item['searchText'] = title + ' ' + html_text

        if qa_info:
            qa_content = read_qa_content(qa_info['fullpath'])
            item['searchText'] += ' ' + qa_content
            matched_qa.add(key)

        # 科目を判定
        subject_name, subject_category = classify_subject(title, item['searchText'], subjects)
        item['subject'] = subject_name
        item['subjectCategory'] = subject_category

        items.append(item)

    for key, qa_info in qa_files.items():
        if key not in matched_qa:
            title = Path(qa_info['filename']).stem.replace('_QA', '')
            qa_content = read_qa_content(qa_info['fullpath'])
            search_text = key + ' ' + qa_content

            # 科目を判定
            subject_name, subject_category = classify_subject(title, search_text, subjects)

            items.append({
                'id': key.lower().replace(' ', '-'),
                'title': title,
                'category': 'Q&Aのみ',
                'htmlPath': None,
                'qaPath': qa_mapping.get(key),
                'searchText': search_text,
                'subject': subject_name,
                'subjectCategory': subject_category
            })

    # 科目カテゴリ → 科目 → タイトル でソート
    items.sort(key=lambda x: (x.get('subjectCategory', 'その他'), x.get('subject', 'その他'), x['title']))
    return items


def main():
    print("Building index for GitHub Pages...")

    # 科目マスターを読み込み
    subjects = load_subject_master()

    html_files = find_html_files()
    qa_files = find_qa_files()

    print(f"Found {len(html_files)} HTML files")
    print(f"Found {len(qa_files)} Q&A files")

    print("Copying files...")
    html_mapping, qa_mapping = copy_files(html_files, qa_files)

    print("Building index with subject classification...")
    items = build_index(html_files, qa_files, html_mapping, qa_mapping, subjects)

    js_content = f"// Auto-generated by build_index.py\nconst DATA = {json.dumps(items, ensure_ascii=False, indent=2)};\n"

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"Generated {OUTPUT_FILE}")
    print(f"Total items: {len(items)}")

    with_both = sum(1 for i in items if i['htmlPath'] and i['qaPath'])
    html_only = sum(1 for i in items if i['htmlPath'] and not i['qaPath'])
    qa_only = sum(1 for i in items if not i['htmlPath'] and i['qaPath'])
    print(f"  HTML + Q&A: {with_both}")
    print(f"  HTML only: {html_only}")
    print(f"  Q&A only: {qa_only}")

    # 科目別統計
    print(f"\n科目別統計:")
    from collections import Counter
    subject_counts = Counter(i.get('subject', 'その他') for i in items)
    for subj, count in sorted(subject_counts.items(), key=lambda x: -x[1]):
        print(f"  {subj}: {count}")

    print(f"\nFiles copied to:")
    print(f"  HTML: {DEST_HTML_DIR}")
    print(f"  Q&A: {DEST_QA_DIR}")


if __name__ == '__main__':
    main()
