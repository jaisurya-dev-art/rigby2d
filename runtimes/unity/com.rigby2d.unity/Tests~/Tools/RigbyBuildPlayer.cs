// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the player benchmark (Assets/Bench) for Windows x64 with the scripting backend named after
// -rigbyBackend (il2cpp or mono) into the folder after -rigbyBuild. Run by run-unity.mjs --player.

using System;
using Rigby2D.Unity;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class RigbyBuildPlayer
{
    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == name) return args[i + 1];
        return null;
    }

    public static void Run()
    {
        bool il2cpp = (Arg("-rigbyBackend") ?? "il2cpp") == "il2cpp";
        string outDir = Arg("-rigbyBuild") ?? "Build";
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var cam = new GameObject("Main Camera").AddComponent<Camera>();
        cam.tag = "MainCamera";
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.11f, 0.11f, 0.12f);
        var bench = new GameObject("Bench").AddComponent<RigbyPlayerBench>();
        var so = new SerializedObject(bench);
        so.FindProperty("asset").objectReferenceValue = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>("Assets/Nila/nila.atlas");
        so.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.SaveScene(scene, "Assets/Bench/Bench.unity");

        var target = NamedBuildTarget.Standalone;
        PlayerSettings.SetScriptingBackend(target, il2cpp ? ScriptingImplementation.IL2CPP : ScriptingImplementation.Mono2x);
        PlayerSettings.SetIl2CppCompilerConfiguration(target, Il2CppCompilerConfiguration.Master);
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.defaultScreenWidth = 1280;
        PlayerSettings.defaultScreenHeight = 720;
        PlayerSettings.resizableWindow = true;
        PlayerSettings.runInBackground = true;
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Bench/Bench.unity" },
            locationPathName = outDir + "/RigbyBench.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None,
        });
        Debug.Log($"[rigby-build] {report.summary.result} {(il2cpp ? "IL2CPP" : "Mono")} {report.summary.totalSize / 1048576f:0.0} MB in {report.summary.totalTime.TotalSeconds:0} s");
        EditorApplication.Exit(report.summary.result == BuildResult.Succeeded ? 0 : 1);
    }
}
