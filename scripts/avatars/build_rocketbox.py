# Converts a Microsoft Rocketbox "facial" avatar (MIT) into a TalkingHead GLB,
# headless, with no Mixamo re-rig: the 3ds Max Biped skeleton gets the Mixamo
# bone names, hierarchy and bone frames TalkingHead's poses assume, the ARKit +
# Oculus viseme shape keys get TalkingHead's names, and the materials are made
# to render as skin and cloth in three.js. See README.md for the setup.
#   blender.exe -b --python build_rocketbox.py -- <in_facial.fbx> <out.glb> [pose=a|t] [eye height m|none]
# Needs, next to this file, TalkingHead's blender/rename-rocketbox-shapekeys.py
# (its shape-key map) and TalkingHead's add-on enabled (fix_bone_axes).
import bpy, sys, os
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1])
POSE = (args[2] if len(args) > 2 else "a").lower()
HERE = os.path.dirname(os.path.abspath(__file__))

# TalkingHead's own shape-key map (its rename-rocketbox-shapekeys.py pairs).
import re
_src = open(os.path.join(HERE, "rename-rocketbox-shapekeys.py"), encoding="utf-8").read()
SHAPEKEY_MAP = dict(re.findall(r'\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]', _src))
if len(SHAPEKEY_MAP) < 60:
    sys.exit("rename-rocketbox-shapekeys.py missing or unreadable next to this script")

BONES = {
    "Bip01 Pelvis": "Hips", "Bip01 Spine": "Spine", "Bip01 Spine1": "Spine1", "Bip01 Spine2": "Spine2",
    "Bip01 Neck": "Neck", "Bip01 Head": "Head", "Bip01 LEye": "LeftEye", "Bip01 REye": "RightEye",
}
for side, S in (("L", "Left"), ("R", "Right")):
    BONES.update({
        f"Bip01 {side} Clavicle": f"{S}Shoulder", f"Bip01 {side} UpperArm": f"{S}Arm",
        f"Bip01 {side} Forearm": f"{S}ForeArm", f"Bip01 {side} Hand": f"{S}Hand",
        f"Bip01 {side} Thigh": f"{S}UpLeg", f"Bip01 {side} Calf": f"{S}Leg",
        f"Bip01 {side} Foot": f"{S}Foot", f"Bip01 {side} Toe0": f"{S}ToeBase",
    })
    for i, finger in enumerate(["Thumb", "Index", "Middle", "Ring", "Pinky"]):
        BONES[f"Bip01 {side} Finger{i}"] = f"{S}Hand{finger}1"
        BONES[f"Bip01 {side} Finger{i}1"] = f"{S}Hand{finger}2"
        BONES[f"Bip01 {side} Finger{i}2"] = f"{S}Hand{finger}3"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC, automatic_bone_orientation=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# The FBX carries an animation that keys the armature's 0.01 scale and 90°
# turn: it would put them back after the apply below.
for o in bpy.data.objects:
    o.animation_data_clear()
for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)

# Apply the 0.01 scale and the -90° turn so everything is in metres, upright.
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Rename bones (Blender renames the matching vertex groups with them).
missing = [b for b in BONES if b not in arm.data.bones]
if missing:
    sys.exit(f"not a Rocketbox Biped skeleton, missing: {missing}")
for old, new in BONES.items():
    if old in arm.data.bones:
        arm.data.bones[old].name = new
arm.name = "Armature"
arm.data.name = "Armature"

# TalkingHead's poses are Mixamo local rotations, so each bone's rest frame must
# be Mixamo's: Y along the limb towards its child, Z (the roll) as in the
# reference rig. Biped's own frames differ where it matters most: its Head
# bone points FORWARD at the face (the head pose then tipped the face to the
# ceiling), its eyes point down, its toes up. Hierarchy as in Mixamo too:
# clavicles under Spine2 (Biped hangs them off the neck, so turning the head
# turned the shoulders) and thighs under Hips (Biped: under Spine).
from mathutils import Vector
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
for b in eb:
    b.use_connect = False  # moving a tail must never drag a child's joint
for s in ("LeftShoulder", "RightShoulder"):
    eb[s].parent = eb["Spine2"]
for s in ("LeftUpLeg", "RightUpLeg"):
    eb[s].parent = eb["Hips"]
FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"]
def aim(name, direction, length=None):
    b = eb[name]
    b.tail = b.head + Vector(direction).normalized() * (length or b.length)
# The torso keeps its rest shape under TalkingHead's poses only when its rest
# frames ARE the reference rig's (brunette.glb, read in Blender): aimed at the
# next joint instead, Biped's Spine2 leans 18 degrees back and every pose
# hunched the chest forward. Limbs are aimed at their child joint, so a posed
# arm lies where the reference's arm lies whatever the A-pose angle.
TORSO = {"Hips": (0.0, 0.06, 1.0), "Spine": (0.0, 0.09, 1.0), "Spine1": (0.0, 0.16, 0.99),
         "Spine2": (0.0, 0.03, 1.0), "Neck": (0.0, -0.24, 0.97), "Head": (0.0, -0.14, 0.99)}
for name, d in TORSO.items():
    aim(name, d, 0.12)
chain = []
for S in ("Left", "Right"):
    chain += [(f"{S}Shoulder", f"{S}Arm"), (f"{S}Arm", f"{S}ForeArm"), (f"{S}ForeArm", f"{S}Hand"),
              (f"{S}Hand", f"{S}HandMiddle1"), (f"{S}UpLeg", f"{S}Leg"), (f"{S}Leg", f"{S}Foot"),
              (f"{S}Foot", f"{S}ToeBase")]
    for f in FINGERS:
        chain += [(f"{S}Hand{f}1", f"{S}Hand{f}2"), (f"{S}Hand{f}2", f"{S}Hand{f}3")]
for a, c in chain:
    aim(a, eb[c].head - eb[a].head)
for S in ("Left", "Right"):
    aim(f"{S}Eye", (0.0, 0.0, 1.0), 0.03)
    eb[f"{S}Eye"].align_roll(Vector((0.0, -1.0, 0.0)))  # Z looks forward, as in the reference
    aim(f"{S}ToeBase", (0.0, -1.0, 0.0), 0.06)
    for f in FINGERS:
        b2 = eb[f"{S}Hand{f}2"]
        aim(f"{S}Hand{f}3", b2.tail - b2.head)
bpy.ops.object.mode_set(mode="OBJECT")

# TalkingHead add-on: bone rolls to its reference axes.
th = sys.modules.get("talkinghead-addon")
if th is None:
    sys.exit("TalkingHead's Blender add-on is not enabled (README step 2)")
th.fix_bone_axes([arm], th.BONE_AXES_DATA_A if POSE == "a" else th.BONE_AXES_DATA_T)
bpy.ops.object.mode_set(mode="OBJECT")

# Size. TalkingHead's camera stands a fixed number of metres away, so a taller
# figure fills more of the frame: scale to a set eye height (4th argument,
# metres) or keep the character's own size ("none").
SCALE = (args[3] if len(args) > 3 else "none").lower()
f = 1.0 if SCALE == "none" else float(SCALE) / arm.data.bones["LeftEye"].head_local.z
arm.scale = (f, f, f)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
print("SCALED", round(f, 4), "hips", round(arm.data.bones["Hips"].head_local.z, 3), "eye", round(arm.data.bones["LeftEye"].head_local.z, 3))

# Shape keys: TalkingHead's names; drop the rest (FACS / Vive sets it never uses).
for m in meshes:
    keys = m.data.shape_keys.key_blocks if m.data.shape_keys else []
    for k in list(keys):
        if k.name == "Basis":
            continue
        if k.name in SHAPEKEY_MAP:
            k.name = SHAPEKEY_MAP[k.name]
        else:
            m.shape_key_remove(k)
    names = [k.name for k in m.data.shape_keys.key_blocks] if m.data.shape_keys else []
    print("SHAPEKEYS", m.name, len(names), "visemes:", len([n for n in names if n.startswith("viseme_")]))

# Materials: textures from the avatar's Textures folder, no metal, roughness
# from the specular map, hair cut out (MASK), everything else opaque.
tex_dir = os.path.normpath(os.path.join(os.path.dirname(SRC), "..", "Textures"))
for img in bpy.data.images:
    fname = os.path.basename(img.filepath.replace("\\", "/")) if img.filepath else ""
    cand = os.path.join(tex_dir, fname) if fname else ""
    if cand and os.path.exists(cand):
        img.filepath = cand
        img.reload()
        img.name = os.path.splitext(fname)[0]  # e.g. f020_head_color: the size step matches on it
    print("IMG", img.name, fname, "found" if cand and os.path.exists(cand) else "NOT FOUND")
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    bsdf.inputs["Metallic"].default_value = 0.0
    # Rocketbox's specular map arrives as a KHR_materials_specular texture read
    # from its ALPHA channel, which these RGB maps don't have - so every surface
    # rendered at full specular: pale, plastic skin. Turn the map into a
    # roughness map instead (dark = matte skin and cloth, bright = lips, eyes,
    # the sheen of hair) and keep specular itself at a skin-like constant.
    spec_links = list(bsdf.inputs["Specular IOR Level"].links)
    spec_node = next((l.from_node for l in spec_links if l.from_node.type == "TEX_IMAGE"), None)
    spec_img = spec_node.image if spec_node else None
    uv_src = next((l.from_socket for l in spec_node.inputs["Vector"].links), None) if spec_node else None
    for l in spec_links:
        nt.links.remove(l)
    if "Specular Tint" in bsdf.inputs:
        for l in list(bsdf.inputs["Specular Tint"].links):
            nt.links.remove(l)
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    for l in list(bsdf.inputs["Roughness"].links):
        nt.links.remove(l)
    if spec_img is not None and spec_img.has_data is False:
        spec_img.reload()
    if spec_img is not None and spec_img.size[0] > 0:
        w, h = spec_img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        spec_img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        lum = px[:, :3].mean(axis=1)
        rough = np.clip(0.78 - 1.6 * lum, 0.32, 0.8)
        out = np.stack([rough, rough, rough, np.ones_like(rough)], axis=1).astype(np.float32).ravel()
        rimg = bpy.data.images.new(mat.name + "_roughness", w, h, alpha=False, float_buffer=False)
        rimg.colorspace_settings.name = "Non-Color"
        rimg.pixels.foreach_set(out)
        rimg.pack()
        rnode = nt.nodes.new("ShaderNodeTexImage")
        rnode.image = rimg
        if uv_src is not None:
            nt.links.new(uv_src, rnode.inputs["Vector"])
        nt.links.new(rnode.outputs["Color"], bsdf.inputs["Roughness"])
        print("ROUGHNESS from specular", mat.name, "mean", round(float(rough.mean()), 3))
    else:
        bsdf.inputs["Roughness"].default_value = 0.65
    alpha_in = bsdf.inputs["Alpha"]
    links = list(alpha_in.links)
    if "opacity" in mat.name.lower() and links:
        srcsock = links[0].from_socket
        for l in links:
            nt.links.remove(l)
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = 0.35
        nt.links.new(srcsock, gt.inputs[0])
        nt.links.new(gt.outputs[0], alpha_in)
        print("MASK", mat.name)
    else:
        for l in links:
            nt.links.remove(l)
        alpha_in.default_value = 1.0

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_morph=True,
    export_morph_normal=False,
    export_skins=True,
    export_yup=True,
)
print("EXPORTED", OUT)
