// SPDX-License-Identifier: MIT OR Apache-2.0
// Integration check of the Unity package, run inside the Unity Editor in batch mode (see run-unity.mjs):
// imports the demo exports, plays a skeleton and a scene through the components, renders them to
// PNG files, and measures update cost and garbage for a crowd. Writes rigby-check.json and exits
// with 0 when every check passes.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Rigby2D;
using Rigby2D.Unity;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;

public static class RigbyUnityCheck
{
    static readonly List<string> failures = new List<string>();
    static readonly List<string> notes = new List<string>();

    static void Check(bool ok, string what)
    {
        if (!ok) failures.Add(what);
        Debug.Log($"[rigby-check] {(ok ? "ok  " : "FAIL")} {what}");
    }

    public static void Run()
    {
        string outDir = Environment.GetEnvironmentVariable("RIGBY_CHECK_OUT") ?? Path.GetFullPath("CheckOutput");
        Directory.CreateDirectory(outDir);
        try
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Skeleton(outDir);
            Scene(outDir, "");
            Crowd();
            // The same scene in the other color space: edges must stay clean in both.
            var space = PlayerSettings.colorSpace;
            PlayerSettings.colorSpace = space == ColorSpace.Linear ? ColorSpace.Gamma : ColorSpace.Linear;
            Scene(outDir, "_" + PlayerSettings.colorSpace.ToString().ToLowerInvariant());
            PlayerSettings.colorSpace = space;
        }
        catch (Exception e)
        {
            failures.Add("exception: " + e);
            Debug.LogException(e);
        }
        File.WriteAllText(Path.Combine(outDir, "rigby-check.json"), JsonUtility.ToJson(new Result { failures = failures.ToArray(), notes = notes.ToArray(), colorSpace = PlayerSettings.colorSpace.ToString(), unity = Application.unityVersion }, true));
        Debug.Log($"[rigby-check] {(failures.Count == 0 ? "PASS" : "FAIL")} ({failures.Count} failures)");
        EditorApplication.Exit(failures.Count == 0 ? 0 : 1);
    }

    [Serializable]
    class Result
    {
        public string[] failures, notes;
        public string colorSpace, unity;
    }

    static void Skeleton(string outDir)
    {
        var asset = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>("Assets/Rigbytron/rigbytron.atlas");
        Check(asset != null, "the .atlas importer made a RigbySkeletonAsset");
        if (asset == null) return;
        Check(asset.Data != null, "the skeleton loads: " + asset.LoadError);
        if (asset.Data == null) return;
        Check(asset.Pages.Count == 1 && asset.Pages[0] != null, "the atlas page texture is linked");
        var ti = (TextureImporter)AssetImporter.GetAtPath("Assets/Rigbytron/rigbytron.png");
        Check(ti != null && !ti.sRGBTexture && !ti.mipmapEnabled, "atlas pages import as raw pixels (sRGB off, no mipmaps)");

        var go = new GameObject("Rigbytron", typeof(MeshFilter), typeof(MeshRenderer));
        var s = go.AddComponent<RigbySkeleton>();
        s.SkeletonAsset = asset;
        s.UpdateMode = RigbyUpdateMode.Manual;
        int events = 0, completes = 0;
        s.AnimationEvent += (_, e) => events++;
        s.AnimationCompleted += (_, t, n) => completes++;
        Check(s.Play("release", false, 0f), "Play(\"release\")");
        for (int i = 0; i < 60; i++) s.Advance(1f / 30f);
        var mesh = go.GetComponent<MeshFilter>().sharedMesh;
        Check(mesh != null && mesh.vertexCount > 0 && mesh.subMeshCount >= 1, $"the mesh has geometry ({mesh?.vertexCount} vertices, {mesh?.subMeshCount} sub-meshes)");
        var mats = go.GetComponent<MeshRenderer>().sharedMaterials;
        Check(mats.Length == mesh.subMeshCount && mats.All(m => m != null && m.shader.name == "Rigby2D/Skeleton"), "one Rigby2D/Skeleton material per sub-mesh");
        Check(events == 1 && completes == 1, $"the slash event and the completion fired once each ({events}, {completes})");

        // The component's pose is the core's pose: compare with a pose driven directly.
        var pose = new SkeletonPose(asset.Data);
        var state = new Rigby2D.PlaybackState();
        state.SetAnimation(asset.Data, 0, "release", false, 0);
        for (int i = 0; i < 60; i++) state.Update(asset.Data, 1.0 / 30.0);
        state.Apply(asset.Data, pose);
        int hand = asset.Data.FindBone("hand_r");
        var p = s.GetBoneLocalPosition(hand);
        Check(Mathf.Abs(p.x - (float)pose.World[hand].Tx / 100f) < 1e-4f && Mathf.Abs(p.y - (float)pose.World[hand].Ty / 100f) < 1e-4f, "bone positions match the core runtime");
        var b = mesh.bounds;
        notes.Add($"rigbytron bounds {b.size}");

        // Renders: the release swing, flipped and tinted copies.
        s.Play("release", false, 0f);
        s.Advance(0.42f);
        var g2 = UnityEngine.Object.Instantiate(go);
        g2.transform.position = new Vector3(4.2f, 0, 0);
        var s2 = g2.GetComponent<RigbySkeleton>();
        s2.FlipX = true;
        s2.Color = new Color(1f, 0.6f, 0.6f, 0.75f);
        s2.Play("hold", true, 0);
        s2.Advance(0.5f);
        Render(Path.Combine(outDir, "skeleton.png"), new Vector3(2.1f, 4.6f, -10), 6f);
        UnityEngine.Object.DestroyImmediate(go);
        UnityEngine.Object.DestroyImmediate(g2);
    }

    static void Scene(string outDir, string suffix)
    {
        var asset = AssetDatabase.LoadAssetAtPath<RigbySceneAsset>("Assets/Scene/scene.rigbyscene.asset");
        Check(asset != null, "the scene import made a RigbySceneAsset");
        if (asset == null) return;
        Check(asset.LoadError == null, "the scene loads: " + asset.LoadError);
        var go = new GameObject("Scene", typeof(MeshFilter), typeof(MeshRenderer));
        var cam = NewCamera();
        var sc = go.AddComponent<RigbyScene>();
        var so = new SerializedObject(sc);
        so.FindProperty("followCamera").objectReferenceValue = cam;
        so.FindProperty("followZoom").boolValue = true;
        so.FindProperty("frameHeight").floatValue = 1080f * 1.2f / 100f;
        so.FindProperty("updateMode").enumValueIndex = (int)RigbyUpdateMode.Manual;
        so.ApplyModifiedPropertiesWithoutUndo();
        sc.SceneAsset = asset;
        Check(sc.Player != null, "the scene player starts");
        if (sc.Player == null) return;
        Check(sc.Play("meet", false), "Play(\"meet\")");
        int finished = 0;
        sc.ShotFinished += _ => finished++;
        var mesh = go.GetComponent<MeshFilter>().sharedMesh;
        var times = new[] { 2f, 4f, 7f };
        float t = 0;
        for (int k = 0; k < times.Length; k++)
        {
            while (t < times[k] - 1e-4f)
            {
                sc.Advance(1f / 30f);
                t += 1f / 30f;
            }
            var lu = typeof(RigbyScene).GetMethod("LateUpdate", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            lu.Invoke(sc, null);
            Render(Path.Combine(outDir, $"scene_{k}{suffix}.png"), cam.transform.position, cam.orthographicSize, cam);
        }
        Check(mesh.vertexCount > 0 && mesh.subMeshCount >= 3, $"the scene draws the stage and both characters ({mesh.vertexCount} vertices, {mesh.subMeshCount} sub-meshes)");
        var hand = sc.GetActorBoneWorldPosition("NILA", "hand_r");
        Check(hand != go.transform.position, "actor bones are reachable");
        while (t < sc.Duration + 0.1f)
        {
            sc.Advance(1f / 30f);
            t += 1f / 30f;
        }
        Check(finished == 1, $"ShotFinished fired once at the end ({finished})");
        UnityEngine.Object.DestroyImmediate(go);
        UnityEngine.Object.DestroyImmediate(cam.gameObject);
    }

    static void Crowd()
    {
        var asset = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>("Assets/Nila/nila.atlas") ?? AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>("Assets/Rigbytron/rigbytron.atlas");
        if (asset == null || asset.Data == null) return;
        const int count = 200;
        var list = new List<RigbySkeleton>();
        string anim = asset.Data.Animations[0].Name;
        for (int i = 0; i < count; i++)
        {
            var go = new GameObject("c" + i, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.position = new Vector3(i % 20, i / 20, 0);
            var s = go.AddComponent<RigbySkeleton>();
            s.SkeletonAsset = asset;
            s.UpdateMode = RigbyUpdateMode.Manual;
            s.UpdateWhenInvisible = true;
            s.Play(anim, true, 0);
            s.Advance(i * 0.013f);
            list.Add(s);
        }
        // Warm up, then measure.
        for (int f = 0; f < 30; f++)
            foreach (var s in list)
                s.Advance(1f / 60f);
        GC.Collect();
        long before = GC.GetTotalMemory(false);
        int gcBefore = GC.CollectionCount(0);
        var sw = Stopwatch.StartNew();
        const int frames = 120;
        for (int f = 0; f < frames; f++)
            foreach (var s in list)
                s.Advance(1f / 60f);
        sw.Stop();
        long allocated = GC.GetTotalMemory(false) - before;
        int collections = GC.CollectionCount(0) - gcBefore;
        double usPerSkeleton = sw.Elapsed.TotalMilliseconds * 1000.0 / (frames * count);
        var data = asset.Data;
        notes.Add($"crowd: {count} x {asset.name} ({data.Bones.Count} bones, {data.Slots.Count} slots): {usPerSkeleton:0.0} µs per skeleton per frame (animate + constraints + physics + mesh upload), {sw.Elapsed.TotalMilliseconds / frames:0.00} ms per frame for all");
        notes.Add($"crowd: {allocated / 1024} KB allocated over {frames} frames, {collections} GC collections");
        Check(allocated < 64 * 1024 * frames / 120, $"steady playback allocates (almost) nothing ({allocated / 1024} KB over {frames} frames)");
        // Where the time goes: animation alone, then geometry alone (same Mono JIT).
        var swa = Stopwatch.StartNew();
        for (int f = 0; f < frames; f++)
            foreach (var s in list)
            {
                s.State.Update(data, 1.0 / 60.0);
                s.State.Apply(data, s.Pose);
            }
        swa.Stop();
        var builder = new MeshBuilder();
        var swb = Stopwatch.StartNew();
        for (int f = 0; f < frames; f++)
            foreach (var s in list) builder.Build(s.Pose, asset.Lookup, Color4.White);
        swb.Stop();
        // The runner: every skeleton through the frame phases, on one core, then on all of them.
        var run = typeof(RigbySkeleton).Assembly.GetType("Rigby2D.Unity.RigbyRunner").GetMethod("RunFrame", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        foreach (var s in list) s.UpdateMode = RigbyUpdateMode.Normal;
        int threads = RigbySettings.WorkerThreads;
        double Measure(int workers)
        {
            RigbySettings.WorkerThreads = workers;
            for (int f = 0; f < 10; f++) run.Invoke(null, new object[] { list });
            long mem = GC.GetTotalMemory(false);
            var sw = Stopwatch.StartNew();
            for (int f = 0; f < frames; f++) run.Invoke(null, new object[] { list });
            sw.Stop();
            notes.Add($"runner with {workers} worker threads: {sw.Elapsed.TotalMilliseconds / frames:0.00} ms per frame for {count} skeletons, {(GC.GetTotalMemory(false) - mem) / 1024} KB allocated (including the test's reflection calls)");
            return sw.Elapsed.TotalMilliseconds / frames;
        }
        double serial = Measure(0), parallel = Measure(threads);
        RigbySettings.WorkerThreads = threads;
        Check(parallel < serial, $"the runner is faster on {threads} worker threads ({parallel:0.00} ms) than on one core ({serial:0.00} ms)");
        notes.Add($"crowd breakdown (Mono): animate {swa.Elapsed.TotalMilliseconds * 1000.0 / (frames * count):0.0} µs, geometry {swb.Elapsed.TotalMilliseconds * 1000.0 / (frames * count):0.0} µs, the rest is the Unity mesh upload");
        foreach (var s in list) UnityEngine.Object.DestroyImmediate(s.gameObject);
    }

    static Camera NewCamera()
    {
        var cam = new GameObject("Camera").AddComponent<Camera>();
        cam.orthographic = true;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.12f, 0.12f, 0.13f, 1f);
        cam.transform.position = new Vector3(0, 0, -10);
        return cam;
    }

    static void Render(string path, Vector3 position, float size, Camera existing = null)
    {
        var cam = existing != null ? existing : NewCamera();
        cam.transform.position = position;
        cam.orthographicSize = size;
        var rt = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { antiAliasing = 4 };
        cam.targetTexture = rt;
        cam.Render();
        RenderTexture.active = rt;
        var tex = new Texture2D(1280, 720, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
        tex.Apply();
        File.WriteAllBytes(path, tex.EncodeToPNG());
        RenderTexture.active = null;
        cam.targetTexture = null;
        UnityEngine.Object.DestroyImmediate(rt);
        UnityEngine.Object.DestroyImmediate(tex);
        if (existing == null) UnityEngine.Object.DestroyImmediate(cam.gameObject);
        notes.Add("rendered " + Path.GetFileName(path));
    }
}
