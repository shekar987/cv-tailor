# Builds one mock-interview interviewer as a TalkingHead-ready GLB, headless:
#   blender.exe -b --python build_avatar.py -- <preset> <out.glb>
# MPFB 2.0.17 + CC0 MakeHuman assets (system assets, skins01/02, suits01,
# visemes02, faceunits01) + TalkingHead's custom rig and add-on, following
# TalkingHead's blender/MPFB/MPFB.md recipe step by step.
import bpy, sys, math

from bl_ext.user_default.mpfb.services import HumanService, ExportService, TargetService, FaceService, ObjectService

args = sys.argv[sys.argv.index("--") + 1:]
PRESET, OUT = args[0], args[1]

PRESETS = {
    # Emma Clarke — early 30s, bob, natural make-up, women's suit.
    "emma": {
        "phenotype": {"gender": 0.0, "age": 0.55, "muscle": 0.45, "weight": 0.45, "proportions": 0.65, "height": 0.5,
                      "cupsize": 0.45, "firmness": 0.55, "race": {"asian": 0.05, "caucasian": 0.9, "african": 0.05}},
        "skin_mhmat": "toigo_light_skin_with_natural_makeup/toigo_light_skin_with_natural_makeup.mhmat",
        "eyes": "high-poly/high-poly.mhclo",
        "eyebrows": "eyebrow010/eyebrow010.mhclo",
        "eyelashes": "eyelashes02/eyelashes02.mhclo",
        "teeth": "teeth_base/teeth_base.mhclo",
        "tongue": "tongue01/tongue01.mhclo",
        "hair": "ponytail01/ponytail01.mhclo",
        "clothes": ["toigo_female_suit/toigo_female_suit.mhclo", "shoes02/shoes02.mhclo"],
    },
    # Daniel Okafor — late 30s, short hair, suit and tie.
    "daniel": {
        "phenotype": {"gender": 1.0, "age": 0.6, "muscle": 0.55, "weight": 0.5, "proportions": 0.65, "height": 0.55,
                      "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.02, "caucasian": 0.08, "african": 0.9}},
        "skin_mhmat": "middleage_african_male/middleage_african_male.mhmat",
        "eyes": "high-poly/high-poly.mhclo",
        "eyebrows": "eyebrow001/eyebrow001.mhclo",
        "eyelashes": "eyelashes01/eyelashes01.mhclo",
        "teeth": "teeth_base/teeth_base.mhclo",
        "tongue": "tongue01/tongue01.mhclo",
        "hair": "short01/short01.mhclo",
        "clothes": ["toigo_male_suit_3/toigo_male_suit_3.mhclo", "shoes01/shoes01.mhclo"],
    },
}
preset = PRESETS[PRESET]

# A clean scene.
bpy.ops.wm.read_factory_settings(use_empty=True)

info = HumanService._create_default_human_info_dict()
info.update(preset)
info["name"] = PRESET
info["rig"] = "custom.talkinghead"
info["skin_material_type"] = "GAMEENGINE"
info["eyes_material_type"] = "GAMEENGINE"
info["clothes_material_type"] = "GAMEENGINE"
info["alternative_materials"] = {}
settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0  # web: no subdivision
settings["material_instances"] = "NEVER"
basemesh = HumanService.deserialize_from_dict(info, settings)
print("BUILT basemesh:", basemesh.name)

# Export copy: bake shape keys, load Meta visemes + ARKit face units,
# interpolate, bake masks (the body under the suit goes), drop helpers.
collection = bpy.data.collections.new("export copy")
bpy.context.scene.collection.children.link(collection)
export_copy = ExportService.create_character_copy(basemesh, name_suffix="_export", place_in_collection=collection)
new_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(export_copy)
TargetService.bake_targets(new_basemesh)
FaceService.load_targets(new_basemesh, load_microsoft_visemes=False, load_meta_visemes=True, load_arkit_faceunits=True)
FaceService.interpolate_targets(new_basemesh)
ExportService.bake_modifiers_remove_helpers(new_basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)

# Keep only the export copy.
keep = set(collection.all_objects)
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)

armature = next(o for o in collection.all_objects if o.type == "ARMATURE")
armature.name = "Armature"
armature.data.name = "Armature"

# TalkingHead add-on: fix bone rolls for the A-pose so nothing twists.
th = sys.modules.get("talkinghead-addon")
bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
th.fix_bone_axes([armature], th.BONE_AXES_DATA_A)
bpy.ops.object.mode_set(mode="OBJECT")

# Apply all transforms.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

if "--dump" in sys.argv:
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        print("MAT", mat.name, "nodes:", sorted({n.type + ("/" + n.node_tree.name if n.type == "GROUP" and n.node_tree else "") for n in nt.nodes}))
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            for inp in ("Base Color", "Alpha", "Normal"):
                ls = bsdf.inputs[inp].links
                print("   ", inp, "<-", [(l.from_node.type, l.from_node.name, getattr(getattr(l.from_node, "image", None), "name", None)) for l in ls])

# Materials for glTF: hair, brows and lashes cut out (MASK via a Greater
# Than node before Alpha); everything else opaque (alpha unlinked).
CUTOUT = ("hair", "bob", "short", "ponytail", "eyebrow", "eyelash", "high-poly")
# MakeHuman marks hair very glossy (shininess 0.96): as glTF that is a mirror
# that reflects the room light as a white sheen. Realistic roughness instead.
ROUGH = (("bob", 0.85), ("short", 0.85), ("ponytail", 0.85), ("eyebrow", 0.9), ("eyelash", 0.9), ("high-poly", 0.25), ("teeth", 0.4), ("tongue", 0.5), ("body", 0.6))
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    rough = next((r for k, r in ROUGH if k in mat.name.lower()), 0.8)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    alpha_in = bsdf.inputs["Alpha"]
    links = list(alpha_in.links)
    if any(k in mat.name.lower() for k in CUTOUT) and links:
        src = links[0].from_socket
        for l in links:
            nt.links.remove(l)
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = 0.4
        nt.links.new(src, gt.inputs[0])
        nt.links.new(gt.outputs[0], alpha_in)
        print("MASK", mat.name)
    else:
        for l in links:
            nt.links.remove(l)
        alpha_in.default_value = 1.0

# Shape keys the GLB must carry.
mesh = new_basemesh
names = [k.name for k in (mesh.data.shape_keys.key_blocks if mesh.data.shape_keys else [])]
print("SHAPEKEYS", len(names), "visemes:", len([n for n in names if n.startswith("viseme_")]), "sample:", names[:8])

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
