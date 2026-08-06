# ============================================================
# アバターのパーツ OBJ → GLB 変換（2026-08-03追加）
#
# gen_avatar_obj.mjs が出す OBJ を、Web側が読める GLB にする。
#
# なぜマテリアル名を付け直すのか:
#   avatar_glb.js は **マテリアル名** を見て色を塗り分ける（MatHair/MatSkin/…）。
#   OBJ側はグループ名（hair / cloth / dark / glow …）で部位を分けているので、
#   ここで名前を対応付けてから書き出す。
#   これを飛ばすと、色の指定が一切効かない灰色のパーツになる。
#
# 使い方:
#   "C:/Program Files/Blender Foundation/Blender 4.2/blender.exe" --background --factory-startup \
#     --python tools/obj_to_glb.py -- <入力OBJ> <出力GLB>
# ============================================================

import bpy
import sys
import os

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []
if len(argv) < 2:
    raise SystemExit('usage: obj_to_glb.py -- <in.obj> <out.glb>')

src, dst = argv[0], argv[1]

# OBJのグループ名 → avatar_glb.js が見るマテリアル名
MAT_BY_GROUP = {
    'hair': 'MatHair',
    'skin': 'MatSkin',
    'cloth': 'MatCloth',
    'dark': 'MatAcc',   # メガネ・サングラスのフレーム（ほぼ黒の固定色）
    'glow': 'MatGlow',  # 天使の輪・羽（光る固定色）
    'armL': 'MatSkin',
    'armR': 'MatSkin',
    'legL': 'MatDark',
    'legR': 'MatDark',
    'eye': 'MatEye',       # 本人の左目・上（黒っぽい側）
    'eyeR': 'MatEyeR',     # 本人の右目・上（2026-08-07 左右分割）
    'eyecR': 'MatEyeCR',   # 本人の右目・下（2026-08-07 左右分割）
    'eyec': 'MatEyeC',
    'eyew': 'MatEyeGlint',
    'cheek': 'MatCheek',
}

# まっさらにする
bpy.ops.wm.read_factory_settings(use_empty=True)

# Blender 4.x の OBJ 読み込み
bpy.ops.wm.obj_import(filepath=src, forward_axis='NEGATIVE_Z', up_axis='Y')

for obj in list(bpy.data.objects):
    if obj.type != 'MESH':
        continue
    # OBJの `o <名前>` がそのままオブジェクト名になる。
    # 同名が続くと Blender が .001 を付けるので、そこを落として素の名前に戻す
    base = obj.name.split('.')[0]
    obj.name = base
    obj.data.name = base

    mat_name = MAT_BY_GROUP.get(base)
    if not mat_name:
        # 想定していないグループ名。気づけるように出しておく（色は付かない）
        print(f'[obj_to_glb] 未知のグループ名: {base}')
        continue
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    obj.data.materials.clear()
    obj.data.materials.append(mat)

os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_apply=True,
    export_materials='EXPORT',
    # アニメーションもカメラもライトも要らない（パーツだけ）
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)

tris = sum(len(o.data.loop_triangles) for o in bpy.data.objects if o.type == 'MESH')
print(f'[obj_to_glb] {os.path.basename(src)} -> {os.path.basename(dst)} objs={len(bpy.data.objects)} tris={tris}')
