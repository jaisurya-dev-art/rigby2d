// SPDX-License-Identifier: MIT OR Apache-2.0
// Inspectors (animation, skin and shot pickers instead of typed names), drag-and-drop of skeleton
// and scene assets into the Scene view or Hierarchy, and GameObject menu items.

using System;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Rigby2D.Unity.Editor
{
    static class Pickers
    {
        /// <summary>A dropdown of names for a string property (first entry "(none)" = empty).</summary>
        public static void Names(SerializedProperty prop, string label, string[] names, string none = "(none)")
        {
            if (names == null || names.Length == 0)
            {
                EditorGUILayout.PropertyField(prop, new GUIContent(label));
                return;
            }
            var options = new[] { none }.Concat(names).ToArray();
            int index = Array.IndexOf(names, prop.stringValue) + 1;
            if (index == 0 && !string.IsNullOrEmpty(prop.stringValue)) options[0] = $"{prop.stringValue} (missing)";
            int chosen = EditorGUILayout.Popup(label, index, options);
            if (chosen != index) prop.stringValue = chosen == 0 ? "" : names[chosen - 1];
        }
    }

    [CustomEditor(typeof(RigbySkeleton))]
    [CanEditMultipleObjects]
    public sealed class RigbySkeletonEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            var asset = serializedObject.FindProperty("skeletonAsset");
            EditorGUILayout.PropertyField(asset);
            var sk = (target as RigbySkeleton)?.SkeletonAsset;
            var data = sk != null ? sk.Data : null;
            if (sk != null && data == null) EditorGUILayout.HelpBox(sk.LoadError ?? "The skeleton could not be loaded.", MessageType.Error);
            Pickers.Names(serializedObject.FindProperty("animationName"), "Animation", data?.Animations.Select(a => a.Name).ToArray());
            EditorGUILayout.PropertyField(serializedObject.FindProperty("loop"));
            Pickers.Names(serializedObject.FindProperty("skinName"), "Skin", data?.Skins.Select(s => s.Name).ToArray(), "default");
            EditorGUILayout.PropertyField(serializedObject.FindProperty("timeScale"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("updateMode"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("color"));
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.PrefixLabel("Flip");
                var fx = serializedObject.FindProperty("flipX");
                var fy = serializedObject.FindProperty("flipY");
                fx.boolValue = GUILayout.Toggle(fx.boolValue, "X", "Button", GUILayout.Width(36));
                fy.boolValue = GUILayout.Toggle(fy.boolValue, "Y", "Button", GUILayout.Width(36));
            }
            EditorGUILayout.PropertyField(serializedObject.FindProperty("updateWhenInvisible"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("previewInEditMode"), new GUIContent("Preview in Edit Mode"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("onEvent"));
            serializedObject.ApplyModifiedProperties();

            if (data != null && targets.Length == 1)
            {
                EditorGUILayout.Space();
                EditorGUILayout.LabelField($"{data.Bones.Count} bones · {data.Slots.Count} slots · {data.Animations.Count} animations · {data.Skins.Count + 1} skins", EditorStyles.miniLabel);
                if (Application.isPlaying)
                {
                    var s = (RigbySkeleton)target;
                    EditorGUILayout.LabelField("Playing", s.CurrentAnimation(0) ?? "(nothing)");
                }
            }
        }
    }

    [CustomEditor(typeof(RigbyScene))]
    public sealed class RigbySceneEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            EditorGUILayout.PropertyField(serializedObject.FindProperty("sceneAsset"));
            var asset = serializedObject.FindProperty("sceneAsset").objectReferenceValue as RigbySceneAsset;
            var scene = asset != null ? asset.Scene : null;
            if (asset != null && asset.LoadError != null) EditorGUILayout.HelpBox(asset.LoadError, MessageType.Error);
            var stage = asset != null && asset.StageFile != null ? asset.SkeletonOf(asset.StageFile) : null;
            Pickers.Names(serializedObject.FindProperty("shot"), "Shot", stage != null && stage.Data != null ? stage.Data.Animations.Select(a => a.Name).ToArray() : null, "(first)");
            foreach (var p in new[] { "loop", "playOnStart", "speed", "updateMode", "followCamera", "followZoom", "frameHeight", "previewInEditMode" })
                EditorGUILayout.PropertyField(serializedObject.FindProperty(p));
            serializedObject.ApplyModifiedProperties();
            if (scene != null) EditorGUILayout.LabelField($"{scene.Actors.Count} actors: {string.Join(", ", scene.Actors.Select(a => a.Name))}", EditorStyles.miniLabel);
        }
    }

    [CustomEditor(typeof(RigbySkeletonAsset))]
    public sealed class RigbySkeletonAssetEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var asset = (RigbySkeletonAsset)target;
            var data = asset.Data;
            if (data == null) EditorGUILayout.HelpBox(asset.LoadError ?? "No skeleton.", MessageType.Error);
            else
            {
                EditorGUILayout.LabelField("Skeleton", asset.SkeletonFile);
                EditorGUILayout.LabelField("Format", data.Version ?? "?");
                EditorGUILayout.LabelField("Contents", $"{data.Bones.Count} bones, {data.Slots.Count} slots, {data.Ik.Count + data.Constraints.Count} constraints");
                EditorGUILayout.LabelField("Animations", string.Join(", ", data.Animations.Select(a => $"{a.Name} ({a.Duration:0.##} s)")), EditorStyles.wordWrappedLabel);
                if (data.Skins.Count > 0) EditorGUILayout.LabelField("Skins", string.Join(", ", data.Skins.Select(s => s.Name)), EditorStyles.wordWrappedLabel);
                foreach (var w in data.Warnings) EditorGUILayout.HelpBox(w, MessageType.Warning);
            }
            EditorGUILayout.Space();
            EditorGUILayout.HelpBox("Drag this asset into the Scene view or Hierarchy to add it. Pixels per unit and the skeleton file are set on the .atlas file's import settings.", MessageType.Info);
            using (new EditorGUI.DisabledScope(data == null))
                if (GUILayout.Button("Add to the open scene")) RigbyCreate.Skeleton(asset, null, Vector3.zero);
        }
    }

    [InitializeOnLoad]
    static class RigbyCreate
    {
        static RigbyCreate()
        {
            DragAndDrop.AddDropHandler(OnSceneDrop);
            DragAndDrop.AddDropHandler(OnHierarchyDrop);
        }

        public static GameObject Skeleton(RigbySkeletonAsset asset, Transform parent, Vector3 position)
        {
            var go = new GameObject(asset.name, typeof(MeshFilter), typeof(MeshRenderer));
            Undo.RegisterCreatedObjectUndo(go, "Add Rigby2D skeleton");
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            var s = go.AddComponent<RigbySkeleton>();
            var so = new SerializedObject(s);
            so.FindProperty("skeletonAsset").objectReferenceValue = asset;
            var data = asset.Data;
            if (data != null && data.Animations.Count > 0) so.FindProperty("animationName").stringValue = data.Animations[0].Name;
            so.ApplyModifiedPropertiesWithoutUndo();
            s.Initialize(true);
            Selection.activeGameObject = go;
            return go;
        }

        public static GameObject Scene(RigbySceneAsset asset, Transform parent, Vector3 position)
        {
            var go = new GameObject(asset.name.Replace(".rigbyscene", ""), typeof(MeshFilter), typeof(MeshRenderer));
            Undo.RegisterCreatedObjectUndo(go, "Add Rigby2D scene");
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            var s = go.AddComponent<RigbyScene>();
            var so = new SerializedObject(s);
            so.FindProperty("sceneAsset").objectReferenceValue = asset;
            so.FindProperty("followCamera").objectReferenceValue = Camera.main;
            so.ApplyModifiedPropertiesWithoutUndo();
            s.SceneAsset = asset;
            Selection.activeGameObject = go;
            return go;
        }

        static UnityEngine.Object Dragged() => DragAndDrop.objectReferences.FirstOrDefault(o => o is RigbySkeletonAsset || o is RigbySceneAsset);

        static GameObject Add(UnityEngine.Object o, Transform parent, Vector3 position) =>
            o is RigbySkeletonAsset sk ? Skeleton(sk, parent, position) : o is RigbySceneAsset sc ? Scene(sc, parent, position) : null;

        static DragAndDropVisualMode OnSceneDrop(UnityEngine.Object dropUpon, Vector3 worldPosition, Vector2 viewportPosition, Transform parentForDraggedObjects, bool perform)
        {
            var o = Dragged();
            if (o == null) return DragAndDropVisualMode.None;
            if (perform) Add(o, parentForDraggedObjects, new Vector3(worldPosition.x, worldPosition.y, 0f));
            return DragAndDropVisualMode.Copy;
        }

        static DragAndDropVisualMode OnHierarchyDrop(int dropTargetInstanceID, HierarchyDropFlags dropMode, Transform parentForDraggedObjects, bool perform)
        {
            var o = Dragged();
            if (o == null) return DragAndDropVisualMode.None;
            if (perform)
            {
                var target = EditorUtility.InstanceIDToObject(dropTargetInstanceID) as GameObject;
                Add(o, (dropMode & HierarchyDropFlags.DropUpon) != 0 && target != null ? target.transform : parentForDraggedObjects, Vector3.zero);
            }
            return DragAndDropVisualMode.Copy;
        }

        [MenuItem("GameObject/2D Object/Rigby2D Skeleton", false, 10)]
        static void MenuSkeleton(MenuCommand cmd)
        {
            var go = new GameObject("Rigby2D Skeleton", typeof(MeshFilter), typeof(MeshRenderer), typeof(RigbySkeleton));
            GameObjectUtility.SetParentAndAlign(go, cmd.context as GameObject);
            Undo.RegisterCreatedObjectUndo(go, "Add Rigby2D skeleton");
            Selection.activeGameObject = go;
        }

        [MenuItem("GameObject/2D Object/Rigby2D Scene", false, 11)]
        static void MenuScene(MenuCommand cmd)
        {
            var go = new GameObject("Rigby2D Scene", typeof(MeshFilter), typeof(MeshRenderer), typeof(RigbyScene));
            GameObjectUtility.SetParentAndAlign(go, cmd.context as GameObject);
            Undo.RegisterCreatedObjectUndo(go, "Add Rigby2D scene");
            Selection.activeGameObject = go;
        }
    }
}
