// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the package sample (Samples~/Demo) in a Unity project: Rigbytron's export, a demo scene and
// its controller, with Unity's own .meta files. Run by run-unity.mjs --make-sample.

using System.IO;
using Rigby2D.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class RigbyMakeSample
{
    public static void Run()
    {
        const string dir = "Assets/Rigby2D Demo";
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var cam = new GameObject("Main Camera").AddComponent<Camera>();
        cam.tag = "MainCamera";
        cam.orthographic = true;
        cam.orthographicSize = 8f;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.11f, 0.11f, 0.12f);
        cam.transform.position = new Vector3(0f, 6f, -10f);

        var asset = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>(dir + "/rigbytron.atlas");
        var go = new GameObject("Rigbytron", typeof(MeshFilter), typeof(MeshRenderer));
        var s = go.AddComponent<RigbySkeleton>();
        var so = new SerializedObject(s);
        so.FindProperty("skeletonAsset").objectReferenceValue = asset;
        so.FindProperty("animationName").stringValue = "hold";
        so.FindProperty("previewInEditMode").boolValue = true;
        so.ApplyModifiedPropertiesWithoutUndo();

        var controller = new GameObject("Demo").AddComponent<RigbyDemoController>();
        var co = new SerializedObject(controller);
        co.FindProperty("rigbytron").objectReferenceValue = s;
        co.ApplyModifiedPropertiesWithoutUndo();

        EditorSceneManager.SaveScene(scene, dir + "/Demo.unity");
        AssetDatabase.SaveAssets();
        Debug.Log("[rigby-sample] saved " + dir + "/Demo.unity");
        EditorApplication.Exit(File.Exists(dir + "/Demo.unity") ? 0 : 1);
    }
}
