# ============================================================
# clubVERSE の Unity書き出しFBX を、ブラウザ用のGLBに変換する
#
# 使い方（Blender 4.2 が入っていること。Unityは起動していなくてよい）:
#   "C:/Program Files/Blender Foundation/Blender 4.2/blender.exe" --background --factory-startup #     --python tools/build_club_glb.py -- <入力FBX> <出力GLB> <ログJSON>
#
# 入力の作り方（Unity側・2026-07-30 実施の手順）:
#   1. 書き出し用シーンを作り、clubVERSE 以外を消す
#   2. Package Manager → Add package by name → com.unity.formats.fbx
#   3. club_VERSE Group を右クリック → Export To FBX...
#      Export Format=Binary / Include=Model(s) / LOD level=Highest /
#      Object(s) Position=World Absolute / Export Unrendered=OFF / Embed Textures=ON
#
# ここで詰まった点（同じ轍を踏まないように）:
#   ・Keep Instances でメッシュが共有されるので make_single_user が要る
#   ・メッシュは空オブジェクトの子で、親側に cm→m の 0.01 倍が乗っている。
#     parent_clear(CLEAR_KEEP_TRANSFORM) を先にやらないと100倍で出る
#   ・make_single_user を通すとPython側のオブジェクト参照と選択が失効する。
#     必ず引き直してから transform_apply する
#   ・頂点を直接動かした直後の bound_box は更新が遅れる。頂点から数える
# ============================================================
import bpy, sys, json
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, DST, INFO = args[0], args[1], args[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.preferences.addon_enable(module='io_scene_fbx')
except Exception:
    pass
bpy.ops.import_scene.fbx(filepath=SRC)

log = {}


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def world_bbox(objs):
    mn = [1e18] * 3
    mx = [-1e18] * 3
    hit = False
    for o in objs:
        if o.type != 'MESH':
            continue
        hit = True
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return (mn, mx) if hit else (None, None)


# ---- 1. 当たり判定専用を捨てる（名前で判定。子も一緒に）----
JUNK = ('collider', 'Collider', 'trap')


def is_junk(name):
    return any(k in name for k in JUNK)


doomed = set()
for o in bpy.data.objects:
    if is_junk(o.name):
        doomed.add(o.name)
        for c in o.children_recursive:
            doomed.add(c.name)
for n in doomed:
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
log['removed_colliders'] = len(doomed)

# ---- 2. 法線マップを捨てる ----
dropped = set()
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for node in list(mat.node_tree.nodes):
        if node.type == 'TEX_IMAGE' and node.image and 'NormalMap' in node.image.name:
            dropped.add(node.image.name)
            mat.node_tree.nodes.remove(node)
        elif node.type == 'NORMAL_MAP':
            mat.node_tree.nodes.remove(node)
for im in list(bpy.data.images):
    if 'NormalMap' in im.name:
        bpy.data.images.remove(im)
log['dropped_normalmaps'] = sorted(dropped)

# ---- 3. テクスチャ縮小 ----
resized = []
for im in bpy.data.images:
    if im.name == 'Render Result' or not im.has_data:
        continue
    w, h = im.size
    if max(w, h) >= 2048:
        im.scale(max(1, w // 2), max(1, h // 2))
        resized.append({'name': im.name, 'from': [w, h], 'to': list(im.size)})
log['resized'] = resized

# ---- 4. 位置の目印を名前で控える（結合すると取れなくなるため）----
ANCHOR_PATTERNS = {
    'screen': ('Screen_OFF_Set',),
    'stage': ('Combined_Stage', 'STAGE'),
    'entrance': ('Floor_Entrance',),
}
anchor_names = {}
for key, pats in ANCHOR_PATTERNS.items():
    names = [o.name for o in bpy.data.objects if any(p in o.name for p in pats)]
    if names:
        anchor_names[key] = names

# ---- 5. 変換の確定（インスタンス共有を解いてから）----
objs = mesh_objects()
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
# Unity側の Keep Instances でメッシュが共有されている。共有のままだと確定できない
bpy.ops.object.make_single_user(object=True, obdata=True, material=False, animation=False)

# 単一化で参照も選択も入れ替わる。引き直して選択し直してから確定させる
objs = mesh_objects()
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
# メッシュは空オブジェクトの子で、親側に 0.01 倍（cm→m）が乗っている。
# 親子を解いてからでないと、その分がメッシュに焼き込まれず100倍のまま出てしまう
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 目印の位置を控える（結合前・オフセット前のワールド座標）
anchors_raw = {}
for key, names in anchor_names.items():
    got = [bpy.data.objects[n] for n in names if n in bpy.data.objects]
    a, b = world_bbox(got)
    if a is None:
        # メッシュを持たない目印（空オブジェクト）は位置だけ使う
        pts = [bpy.data.objects[n].matrix_world.translation for n in names if n in bpy.data.objects]
        if not pts:
            continue
        a = [min(p[i] for p in pts) for i in range(3)]
        b = [max(p[i] for p in pts) for i in range(3)]
    anchors_raw[key] = (a, b)

# ---- 6. 結合（描画コールを減らす）----
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = 'clubVERSE'
log['joined_from'] = len(objs)

for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)

# ---- 7. 原点合わせ ----
# 結合後にもう一度確定させる（matrix_world を手で潰すとスケールごと消えるのでやらない）
bpy.ops.object.select_all(action='DESELECT')
joined.select_set(True)
bpy.context.view_layer.objects.active = joined
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 演算子ではなく頂点を直接動かす。結合後の座標系で確実に効かせるため。
mn, mx = world_bbox([joined])
# Blenderは Z が高さ。会場の中心を原点に、床を Z=0 に
offset = Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))
me = joined.data
for v in me.vertices:
    v.co += offset
me.update()

log['bbox_before'] = {'min': [round(v, 2) for v in mn], 'max': [round(v, 2) for v in mx]}
log['offset_applied'] = [round(v, 2) for v in offset]


# Blender(Z-up) → three.js(Y-up): X=X, Y=Z, Z=-Y
def to_threejs(v):
    return [round(v[0], 2), round(v[2], 2), round(-v[1], 2)]


anchors = {}
for key, (a, b) in anchors_raw.items():
    a = [a[i] + offset[i] for i in range(3)]
    b = [b[i] + offset[i] for i in range(3)]
    center = [(a[i] + b[i]) / 2 for i in range(3)]
    anchors[key] = {
        'center': to_threejs(center),
        'min': to_threejs(a),
        'max': to_threejs(b),
        'size_wdh': [round(b[0] - a[0], 2), round(b[1] - a[1], 2), round(b[2] - a[2], 2)],
        'objects': anchor_names[key][:6],
    }
log['anchors'] = anchors

joined.data.calc_loop_triangles()
# bound_box は頂点を直接動かした直後だと更新が追いつかないので、頂点から数える
mn2 = [min(v.co[i] for v in me.vertices) for i in range(3)]
mx2 = [max(v.co[i] for v in me.vertices) for i in range(3)]
log['final'] = {
    'triangles': len(joined.data.loop_triangles),
    'vertices': len(joined.data.vertices),
    'material_slots': len(joined.data.materials),
    'min_threejs': to_threejs(mn2),
    'max_threejs': to_threejs(mx2),
    'width_x': round(mx2[0] - mn2[0], 2),
    'depth_z': round(mx2[1] - mn2[1], 2),
    'height_y': round(mx2[2] - mn2[2], 2),
}

# ---- 8. 書き出し ----
bpy.ops.object.select_all(action='DESELECT')
joined.select_set(True)
kw = dict(
    filepath=DST,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
)
try:
    bpy.ops.export_scene.gltf(export_image_format='WEBP', export_image_quality=80, **kw)
    log['image_format'] = 'WEBP'
except TypeError:
    bpy.ops.export_scene.gltf(export_image_format='JPEG', export_image_quality=80, **kw)
    log['image_format'] = 'JPEG'

with open(INFO, 'w', encoding='utf-8') as f:
    json.dump(log, f, ensure_ascii=False, indent=1)
print('===JSON_START===')
print(json.dumps(log, ensure_ascii=False, indent=1))
print('===JSON_END===')
