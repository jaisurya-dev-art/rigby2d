// SPDX-License-Identifier: MIT OR Apache-2.0
// Timing of the C# core: animate + constraints + physics + world transforms, then mesh geometry,
// per skeleton per frame (median of several runs). Run: node run.mjs --bench <skeleton> [<atlas>]

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Rigby2D;

static class Bench
{
    public static int Run(string skeletonPath, string atlasPath)
    {
        var sk = Skeletons.Load(File.ReadAllBytes(skeletonPath));
        var lookup = new RegionLookup(sk, Atlas.Parse(atlasPath != null ? File.ReadAllText(atlasPath) : ""));
        const int count = 100, frames = 240;
        var poses = new List<SkeletonPose>();
        var states = new List<PlaybackState>();
        var builders = new List<MeshBuilder>();
        string anim = sk.Animations[0].Name;
        for (int i = 0; i < count; i++)
        {
            var s = new PlaybackState();
            s.SetAnimation(sk, 0, anim, true, 0);
            s.Update(sk, i * 0.013);
            states.Add(s);
            poses.Add(new SkeletonPose(sk));
            builders.Add(new MeshBuilder());
        }
        var animate = new List<double>();
        var geometry = new List<double>();
        for (int run = 0; run < 7; run++)
        {
            var sw = Stopwatch.StartNew();
            for (int f = 0; f < frames; f++)
                for (int i = 0; i < count; i++)
                {
                    states[i].Update(sk, 1.0 / 60.0);
                    states[i].Apply(sk, poses[i]);
                }
            animate.Add(sw.Elapsed.TotalMilliseconds * 1000.0 / (frames * count));
            sw.Restart();
            for (int f = 0; f < frames; f++)
                for (int i = 0; i < count; i++)
                    builders[i].Build(poses[i], lookup, Color4.White);
            geometry.Add(sw.Elapsed.TotalMilliseconds * 1000.0 / (frames * count));
        }
        animate.Sort();
        geometry.Sort();
        Console.WriteLine($"{Path.GetFileName(skeletonPath)}: {sk.Bones.Count} bones, {sk.Slots.Count} slots, {builders[0].VertexCount} vertices");
        Console.WriteLine($"  animate + constraints + physics: {animate[3]:0.0} µs per skeleton per frame (median)");
        Console.WriteLine($"  mesh geometry:                   {geometry[3]:0.0} µs");
        return 0;
    }
}
