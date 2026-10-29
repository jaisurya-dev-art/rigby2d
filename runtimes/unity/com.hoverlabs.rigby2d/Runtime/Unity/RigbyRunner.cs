// SPDX-License-Identifier: MIT OR Apache-2.0
// Updates every playing RigbySkeleton once per frame, on all CPU cores, after your scripts' Update:
//   1. in parallel: advance time and pose each skeleton (animation, constraints, physics);
//   2. main thread: PoseUpdated hooks and animation events (your code always runs here);
//   3. in parallel: build each visible skeleton's geometry;
//   4. main thread: upload meshes.
// Rigby2D's core has no shared mutable state during playback (skeleton data is read-only, every
// instance owns its pose, playback state and mesh buffers), so the parallel phases need no locks.
// The worker threads are persistent and steady playback allocates nothing. WebGL, and crowds too
// small to gain from it, run on the main thread.

using System;
using System.Collections.Generic;
using System.Threading;
using UnityEngine;

namespace Rigby2D.Unity
{
    /// <summary>Global settings of the Rigby2D runtime.</summary>
    public static class RigbySettings
    {
        /// <summary>Worker threads for posing and geometry (0 = main thread only). Defaults to the CPU's cores minus one, at most 8.</summary>
        public static int WorkerThreads = Math.Min(Math.Max(Environment.ProcessorCount - 1, 0), 8);
        /// <summary>Fewer playing skeletons than this run on the main thread (threads would cost more than they save).</summary>
        public static int ParallelThreshold = 8;
    }

    [DefaultExecutionOrder(-1000)]
    [AddComponentMenu("")]
    internal sealed class RigbyRunner : MonoBehaviour
    {
        static RigbyRunner instance;
        static readonly List<RigbySkeleton> skeletons = new List<RigbySkeleton>();
        static RigbySkeleton[] frame = new RigbySkeleton[64];
        static int frameCount;

        public static void Register(RigbySkeleton s)
        {
            if (!Application.isPlaying) return;
            if (!skeletons.Contains(s)) skeletons.Add(s);
            if (instance == null)
            {
                var go = new GameObject("Rigby2D Runner") { hideFlags = HideFlags.HideAndDontSave };
                DontDestroyOnLoad(go);
                instance = go.AddComponent<RigbyRunner>();
            }
        }

        public static void Unregister(RigbySkeleton s) => skeletons.Remove(s);

        void OnDestroy()
        {
            if (instance == this) instance = null;
            Pool.Stop();
        }

        void LateUpdate() => RunFrame(skeletons);

        /// <summary>One frame for a list of skeletons (also used by the integration tests).</summary>
        internal static void RunFrame(List<RigbySkeleton> list)
        {
            frameCount = 0;
            foreach (var s in list)
            {
                if (s == null || !s.PrepareFrame()) continue;
                if (frame.Length <= frameCount) Array.Resize(ref frame, frame.Length * 2);
                frame[frameCount++] = s;
            }
            if (frameCount == 0) return;
            bool parallel = frameCount >= RigbySettings.ParallelThreshold && RigbySettings.WorkerThreads > 0;
#if UNITY_WEBGL && !UNITY_EDITOR
            parallel = false;
#endif
            Run(PosePhase, parallel);
            for (int i = 0; i < frameCount; i++) frame[i].AfterPose();
            Run(GeometryPhase, parallel);
            for (int i = 0; i < frameCount; i++) frame[i].Upload();
            Array.Clear(frame, 0, frameCount);
        }

        static readonly Action<int> PosePhase = i => frame[i].StepPose();
        static readonly Action<int> GeometryPhase = i => frame[i].StepGeometry();

        static void Run(Action<int> work, bool parallel)
        {
            if (parallel) Pool.For(frameCount, work);
            else
                for (int i = 0; i < frameCount; i++) work(i);
        }

        /// <summary>Persistent worker threads; the calling thread works too. No allocation per call.</summary>
        static class Pool
        {
            static Thread[] threads;
            static SemaphoreSlim start;
            static CountdownEvent done;
            static volatile Action<int> job;
            static int count, next;
            static volatile bool stopping;

            public static void For(int n, Action<int> work)
            {
                int workers = RigbySettings.WorkerThreads;
                if (threads == null || threads.Length != workers) Start(workers);
                job = work;
                count = n;
                next = -1;
                done.Reset(workers);
                start.Release(workers);
                Work();
                done.Wait();
                job = null;
            }

            static void Start(int workers)
            {
                Stop();
                stopping = false;
                start = new SemaphoreSlim(0);
                done = new CountdownEvent(workers);
                threads = new Thread[workers];
                for (int i = 0; i < workers; i++)
                {
                    threads[i] = new Thread(Loop) { IsBackground = true, Name = "Rigby2D worker " + i };
                    threads[i].Start();
                }
            }

            public static void Stop()
            {
                if (threads == null) return;
                stopping = true;
                start.Release(threads.Length);
                threads = null;
            }

            static void Loop()
            {
                var s = start;
                var d = done;
                while (true)
                {
                    s.Wait();
                    if (stopping) return;
                    Work();
                    d.Signal();
                }
            }

            static void Work()
            {
                var w = job;
                if (w == null) return;
                int i;
                while ((i = Interlocked.Increment(ref next)) < count) w(i);
            }
        }
    }
}
