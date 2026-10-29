// SPDX-License-Identifier: MIT OR Apache-2.0
// Benchmark in a built player (IL2CPP or Mono): 200 characters on screen, played by the runtime as a
// game would (automatic updates, all cores), then on one core, then the core alone. Writes the
// results as JSON to the path after -rigbyOut and quits.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Rigby2D;
using Rigby2D.Unity;
using UnityEngine;

public sealed class RigbyPlayerBench : MonoBehaviour
{
    [SerializeField] RigbySkeletonAsset asset;
    [SerializeField] int count = 200;
    [SerializeField] int frames = 300;

    [Serializable]
    sealed class Phase
    {
        public string name;
        public int workerThreads;
        public double frameMs, poseMs, eventsMs, geometryMs, uploadMs, totalMs, perSkeletonUs;
        public int drawn;
        public long allocatedBytes;
        public int collections;
    }

    [Serializable]
    sealed class Result
    {
        public string backend, unity, cpu, gpu, skeleton;
        public int cores, bones, slots, vertices, count;
        public Phase[] phases;
        public double coreAnimateUs, coreGeometryUs;
    }

    readonly List<RigbySkeleton> crowd = new List<RigbySkeleton>();

    IEnumerator Start()
    {
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = -1;
        var cam = Camera.main;
        int cols = 20, rows = (count + cols - 1) / cols;
        for (int i = 0; i < count; i++)
        {
            var go = new GameObject("c" + i, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.position = new Vector3((i % cols) * 4.5f, (i / cols) * 7.5f, 0f);
            var s = go.AddComponent<RigbySkeleton>();
            s.SkeletonAsset = asset;
            s.Play(asset.Data.Animations[i % asset.Data.Animations.Count].Name, true, 0f);
            crowd.Add(s);
        }
        cam.orthographic = true;
        cam.orthographicSize = rows * 7.5f * 0.5f + 4f;
        cam.transform.position = new Vector3((cols - 1) * 4.5f * 0.5f, rows * 7.5f * 0.5f, -10f);

        var phases = new List<Phase>();
        int threads = RigbySettings.WorkerThreads;
        foreach (int workers in new[] { threads, 0 })
        {
            RigbySettings.WorkerThreads = workers;
            for (int f = 0; f < 60; f++) yield return null; // warm up
            var p = new Phase { name = workers > 0 ? "all cores" : "one core", workerThreads = workers };
            GC.Collect();
            long mem = GC.GetTotalMemory(false);
            int gc = GC.CollectionCount(0);
            var wall = Stopwatch.StartNew();
            for (int f = 0; f < frames; f++)
            {
                yield return null;
                p.poseMs += RigbyStats.PoseMilliseconds;
                p.eventsMs += RigbyStats.EventsMilliseconds;
                p.geometryMs += RigbyStats.GeometryMilliseconds;
                p.uploadMs += RigbyStats.UploadMilliseconds;
                p.drawn = RigbyStats.Drawn;
            }
            p.frameMs = wall.Elapsed.TotalMilliseconds / frames;
            p.allocatedBytes = GC.GetTotalMemory(false) - mem;
            p.collections = GC.CollectionCount(0) - gc;
            p.poseMs /= frames;
            p.eventsMs /= frames;
            p.geometryMs /= frames;
            p.uploadMs /= frames;
            p.totalMs = p.poseMs + p.eventsMs + p.geometryMs + p.uploadMs;
            p.perSkeletonUs = p.totalMs * 1000.0 / count;
            phases.Add(p);
        }
        RigbySettings.WorkerThreads = threads;

        // The core alone, one thread: animation (time, constraints, physics) and geometry.
        var data = asset.Data;
        var poses = new List<SkeletonPose>();
        var states = new List<PlaybackState>();
        for (int i = 0; i < count; i++)
        {
            var st = new PlaybackState();
            st.SetAnimation(data, 0, data.Animations[0].Name, true, 0);
            st.Update(data, i * 0.013);
            states.Add(st);
            poses.Add(new SkeletonPose(data));
        }
        var builder = new MeshBuilder();
        var swA = new Stopwatch();
        var swG = new Stopwatch();
        for (int f = 0; f < 120; f++)
            for (int i = 0; i < count; i++)
            {
                swA.Start();
                states[i].Update(data, 1.0 / 60.0);
                states[i].Apply(data, poses[i]);
                swA.Stop();
                swG.Start();
                builder.Build(poses[i], asset.Lookup, Color4.White);
                swG.Stop();
            }

        var result = new Result
        {
            backend = Backend(),
            unity = Application.unityVersion,
            cpu = SystemInfo.processorType,
            gpu = SystemInfo.graphicsDeviceName,
            cores = SystemInfo.processorCount,
            skeleton = asset.name,
            bones = data.Bones.Count,
            slots = data.Slots.Count,
            vertices = builder.VertexCount,
            count = count,
            phases = phases.ToArray(),
            coreAnimateUs = swA.Elapsed.TotalMilliseconds * 1000.0 / (120 * count),
            coreGeometryUs = swG.Elapsed.TotalMilliseconds * 1000.0 / (120 * count),
        };
        string outPath = Arg("-rigbyOut") ?? Path.Combine(Application.persistentDataPath, "rigby-bench.json");
        File.WriteAllText(outPath, JsonUtility.ToJson(result, true));
        Application.Quit();
    }

    static string Backend()
    {
#if ENABLE_IL2CPP
        return "IL2CPP";
#else
        return "Mono";
#endif
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == name) return args[i + 1];
        return null;
    }
}
