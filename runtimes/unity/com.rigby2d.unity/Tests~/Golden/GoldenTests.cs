// SPDX-License-Identifier: MIT OR Apache-2.0
// Golden tests: the C# runtime must reproduce the JavaScript runtime (src/core) frame by frame, like
// the Rust runtime does (runtimes/rust/rigby-runtime/tests/golden.rs, whose scenarios this mirrors).
// Golden files come from runtimes/rust/rigby-runtime/tests/golden/*.golden.json.
// Run: node runtimes/unity/com.rigby2d.unity/Tests~/run.mjs

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Rigby2D;

static class GoldenTests
{
    const double Dt = 1.0 / 30.0;

    sealed class Worst
    {
        public double World, Positions, Color;
        public string At = "";
    }

    static double Close(double a, double b)
    {
        if (a == b || (double.IsNaN(a) && double.IsNaN(b))) return 0.0;
        return Math.Abs(a - b) / Math.Max(1.0, Math.Max(Math.Abs(a), Math.Abs(b)));
    }

    /// <summary>Formats a number like JavaScript's String(n) for the values events use.</summary>
    static string JsNumber(double v) => v == Math.Truncate(v) && Math.Abs(v) < 1e15 ? ((long)v).ToString(CultureInfo.InvariantCulture) : v.ToString("R", CultureInfo.InvariantCulture);

    static List<string> Replay(SkeletonData sk, Json scenario, Worst worst, string label)
    {
        var problems = new List<string>();
        string kind = scenario.StrOr("kind", "");
        string animation = scenario.StrOr("animation", "");
        var pose = new SkeletonPose(sk);
        string skinName = scenario["skin"].AsString;
        pose.Skin = skinName != null ? sk.FindSkin(skinName) : -1;
        var state = new PlaybackState();
        var frames = scenario["frames"].AsArray;
        int steps, every;
        switch (kind)
        {
            case "setup": steps = 1; every = 1; break;
            case "mix": steps = 45; every = 2; break;
            case "skin": steps = 20; every = 5; break;
            default: steps = frames.Count * 3; every = 3; break;
        }
        var names = animation.Split('>', '+');
        void Setup(int i)
        {
            if ((kind == "loop" || kind == "skin") && i == 0) state.SetAnimation(sk, 0, animation, true, 0.0);
            else if (kind == "mix")
            {
                if (i == 0) state.SetAnimation(sk, 0, names[0], true, 0.0);
                if (i == 12)
                {
                    state.SetAnimation(sk, 0, names[1], true, 0.25);
                    var e = state.SetAnimation(sk, 1, names[2], false, 0.0);
                    if (e != null) e.Alpha = 0.5;
                    state.AddAnimation(sk, 0, names[0], true, 0.2, 0.5);
                }
            }
        }
        Setup(0);
        var events = new List<string>();
        var drained = new List<StateEvent>();
        int f = 0;
        for (int i = 1; i <= steps; i++)
        {
            Setup(i);
            state.Update(sk, Dt);
            state.Apply(sk, pose);
            state.DrainEvents(drained);
            foreach (var e in drained)
            {
                string name = sk.Animations[e.Animation].Name;
                if (e.Kind == StateEventKind.Event) events.Add($"{e.Track}:{e.Event.Name}@{JsNumber(e.Event.Time)}");
                else if (e.Kind == StateEventKind.Complete) events.Add($"{e.Track}:complete:{name}");
            }
            if (i % every != 0) continue;
            if (f >= frames.Count) break;
            var expected = frames[f++];
            string at = $"{label} {kind} '{animation}' frame {f}";
            var world = expected["world"].AsArray;
            for (int b = 0; b < pose.World.Length; b++)
            {
                var m = pose.World[b];
                double[] vals = { m.A, m.B, m.C, m.D, m.Tx, m.Ty };
                for (int k = 0; k < 6; k++)
                {
                    double want = b * 6 + k < world.Count ? world[b * 6 + k].AsNumber ?? double.NaN : double.NaN;
                    double err = Close(vals[k], want);
                    if (err > worst.World)
                    {
                        worst.World = err;
                        worst.At = $"{at}, bone {sk.Bones[b].Name} value {k}: c# {vals[k]} js {want}";
                    }
                }
            }
            var order = expected["drawOrder"].AsArray.Select(v => (int)v.AsNumber.Value).ToArray();
            if (!order.SequenceEqual(pose.DrawOrder)) problems.Add($"{at}: draw order differs");
            var quads = pose.Quads();
            var eq = expected["quads"].AsArray;
            if (quads.Count != eq.Count)
            {
                problems.Add($"{at}: {quads.Count} drawables, expected {eq.Count}");
                continue;
            }
            for (int q = 0; q < quads.Count; q++)
            {
                var qd = quads[q];
                var e = eq[q];
                if (qd.Slot != (int)e.Num("slot", -1) || sk.Name(qd.Image) != e.StrOr("image", ""))
                {
                    problems.Add($"{at}: slot {sk.Slots[qd.Slot].Name} shows '{sk.Name(qd.Image)}', expected slot {e.Num("slot", -1)} '{e.StrOr("image", "")}'");
                    continue;
                }
                var pos = e["positions"].AsArray;
                if (pos.Count != qd.Positions.Length)
                {
                    problems.Add($"{at}: slot {sk.Slots[qd.Slot].Name} has {qd.Positions.Length} positions, expected {pos.Count}");
                    continue;
                }
                for (int k = 0; k < qd.Positions.Length; k++) worst.Positions = Math.Max(worst.Positions, Close(qd.Positions[k], pos[k].AsNumber ?? double.NaN));
                var col = e["color"].AsArray;
                for (int k = 0; k < 4; k++) worst.Color = Math.Max(worst.Color, Close(qd.Color[k], col[k].AsNumber ?? double.NaN));
            }
            var expectedEvents = expected["events"].AsArray.Select(v => v.AsString ?? "").ToList();
            if (!expectedEvents.SequenceEqual(events)) problems.Add($"{at}: events [{string.Join(", ", events)}], expected [{string.Join(", ", expectedEvents)}]");
            events.Clear();
        }
        return problems;
    }

    static (double world, double pos, string at) WorldError(SkeletonPose pose, Json expected, Func<int, string> boneName, string here)
    {
        var w = expected.AsArray;
        double worst = 0;
        string at = "";
        for (int b = 0; b < pose.World.Length; b++)
        {
            var m = pose.World[b];
            double[] vals = { m.A, m.B, m.C, m.D, m.Tx, m.Ty };
            for (int k = 0; k < 6; k++)
            {
                double e = Close(vals[k], b * 6 + k < w.Count ? w[b * 6 + k].AsNumber ?? double.NaN : double.NaN);
                if (e > worst)
                {
                    worst = e;
                    at = $"{here}, bone {boneName(b)}";
                }
            }
        }
        return (worst, 0, at);
    }

    static List<string> ReplayScene(string root, Json golden, string label)
    {
        var failures = new List<string>();
        string manifest = Path.Combine(root, golden.StrOr("scene", ""));
        string dir = Path.GetDirectoryName(manifest);
        ScenePlayer player;
        try
        {
            player = SceneData.Load(File.ReadAllBytes(manifest), f => File.ReadAllBytes(Path.Combine(dir, f)));
        }
        catch (Exception e)
        {
            failures.Add($"{label}: load failed: {e.Message}");
            return failures;
        }
        double worstWorld = 0, worstPos = 0;
        string at = "";
        var layers = new List<SceneLayer>();
        foreach (var shot in golden["shots"].AsArray)
        {
            string name = shot.StrOr("shot", "");
            player.Play(name, true);
            var frames = shot["frames"].AsArray;
            int f = 0;
            for (int i = 1; ; i++)
            {
                player.Update(Dt);
                if (i % 3 != 0) continue;
                if (f >= frames.Count) break;
                var expected = frames[f++];
                string here = $"{label} '{name}' frame {f}";
                if (Close(player.Time, expected.Num("time", double.NaN)) > 1e-9) failures.Add($"{here}: time {player.Time} expected {expected.Num("time", double.NaN)}");
                var (e1, _, a1) = WorldError(player.Pose, expected["stage"], b => player.Stage.Bones[b].Name, here + " stage");
                if (e1 > worstWorld)
                {
                    worstWorld = e1;
                    at = a1;
                }
                player.DrawList(layers);
                var want = expected["layers"].AsArray.Select(l => (l.AsArray[0].AsNumber.Value, l.AsArray[1].AsNumber.Value)).ToList();
                var got = layers.Select(l => ((double)l.Slot, (double)l.Actor)).ToList();
                if (!want.SequenceEqual(got)) failures.Add($"{here}: draw list differs");
                foreach (var a in expected["actors"].AsArray)
                {
                    string id = a.StrOr("id", "");
                    var c = player.Characters.Find(x => x.Id == id);
                    if (c == null)
                    {
                        failures.Add($"{here}: no character '{id}'");
                        continue;
                    }
                    var (e2, _, a2) = WorldError(c.Pose, a["world"], b => c.Data.Bones[b].Name, $"{here} {id}");
                    if (e2 > worstWorld)
                    {
                        worstWorld = e2;
                        at = a2;
                    }
                    if (a["quads"].IsNull) continue;
                    var quads = c.Pose.Quads();
                    var wq = a["quads"].AsArray;
                    if (quads.Count != wq.Count)
                    {
                        failures.Add($"{here}: {id} has {quads.Count} drawables, expected {wq.Count}");
                        continue;
                    }
                    for (int q = 0; q < quads.Count; q++)
                    {
                        if (c.Data.Name(quads[q].Image) != wq[q].StrOr("image", ""))
                        {
                            failures.Add($"{here}: {id} slot {quads[q].Slot} shows '{c.Data.Name(quads[q].Image)}', expected '{wq[q].StrOr("image", "")}'");
                            continue;
                        }
                        var pos = wq[q]["positions"].AsArray;
                        for (int k = 0; k < quads[q].Positions.Length; k++) worstPos = Math.Max(worstPos, Close(quads[q].Positions[k], k < pos.Count ? pos[k].AsNumber ?? double.NaN : double.NaN));
                    }
                }
            }
            if (f != frames.Count) failures.Add($"{label} '{name}': {f} of {frames.Count} frames played");
        }
        Console.WriteLine($"{label}: max relative error world {worstWorld:0.00e+0} ({at}), positions {worstPos:0.00e+0}");
        if (worstWorld > 1e-6 || worstPos > 1e-6) failures.Add($"{label}: world error {worstWorld:0.00e+0} at {at}, positions {worstPos:0.00e+0}");
        return failures;
    }

    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--bench") return Bench.Run(args[1], args.Length > 2 ? args[2] : null);
        string root = Path.GetFullPath(args.Length > 0 ? args[0] : ".");
        string goldenDir = Path.Combine(root, "runtimes/rust/rigby-runtime/tests/golden");
        var files = Directory.GetFiles(goldenDir, "*.golden.json").OrderBy(f => f, StringComparer.Ordinal).ToList();
        string extra = Environment.GetEnvironmentVariable("RIGBY_GOLDEN_DIR");
        if (!string.IsNullOrEmpty(extra)) files.AddRange(Directory.GetFiles(extra, "*.golden.json"));
        var failures = new List<string>();
        foreach (var file in files)
        {
            var golden = Json.Parse(File.ReadAllText(file));
            string label = golden.StrOr("label", "?");
            if (golden.Has("scene"))
            {
                failures.AddRange(ReplayScene(root, golden, label));
                continue;
            }
            string source = Path.Combine(root, golden.StrOr("file", ""));
            SkeletonData sk;
            try
            {
                sk = Skeletons.Load(File.ReadAllBytes(source));
            }
            catch (Exception e)
            {
                failures.Add($"{label}: load failed: {e.Message}");
                continue;
            }
            var worst = new Worst();
            var problems = new List<string>();
            foreach (var scenario in golden["scenarios"].AsArray) problems.AddRange(Replay(sk, scenario, worst, label));
            Console.WriteLine($"{label}: max relative error world {worst.World:0.00e+0}, positions {worst.Positions:0.00e+0}, color {worst.Color:0.00e+0}");
            // Tolerances: float operations happen in a slightly different order than in JavaScript.
            if (worst.World > 1e-6) failures.Add($"{label}: world error {worst.World:0.00e+0} at {worst.At}");
            if (worst.Positions > 1e-6 || worst.Color > 1e-9) failures.Add($"{label}: drawable error positions {worst.Positions:0.00e+0}, color {worst.Color:0.00e+0}");
            failures.AddRange(problems.Take(8));
            if (problems.Count > 8) failures.Add($"{label}: ... {problems.Count - 8} more problems");
        }
        if (failures.Count == 0)
        {
            Console.WriteLine($"PASS: {files.Count} golden files match the JavaScript runtime");
            return 0;
        }
        Console.WriteLine("FAIL:");
        foreach (var f in failures.Take(20)) Console.WriteLine("  " + f);
        return 1;
    }
}
