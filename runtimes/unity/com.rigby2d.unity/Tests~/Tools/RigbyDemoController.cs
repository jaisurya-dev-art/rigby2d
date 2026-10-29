// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D demo: Rigbytron holds; Space slashes (an event key fires mid-swing), F flips him, and the
// last events show on screen. Demo content (c) Rigby2D, for learning only (see LICENSE.md).

using Rigby2D.Unity;
using UnityEngine;

public sealed class RigbyDemoController : MonoBehaviour
{
    [SerializeField] RigbySkeleton rigbytron;
    string last = "Space: slash · F: flip";

    void Start()
    {
#if UNITY_2023_1_OR_NEWER
        if (rigbytron == null) rigbytron = FindFirstObjectByType<RigbySkeleton>();
#else
        if (rigbytron == null) rigbytron = FindObjectOfType<RigbySkeleton>();
#endif
        rigbytron.AnimationEvent += (skeleton, e) => last = $"event '{e.Name}' at {e.Time:0.00} s";
        rigbytron.AnimationCompleted += (skeleton, track, animation) => last = $"'{animation}' completed";
    }

    // Works with the Input System package and with the legacy Input Manager.
    static bool Pressed(KeyCode key)
    {
#if ENABLE_INPUT_SYSTEM
        var k = UnityEngine.InputSystem.Keyboard.current;
        if (k == null) return false;
        return key == KeyCode.Space ? k.spaceKey.wasPressedThisFrame : key == KeyCode.F && k.fKey.wasPressedThisFrame;
#else
        return Input.GetKeyDown(key);
#endif
    }

    void Update()
    {
        if (Pressed(KeyCode.Space))
        {
            rigbytron.SetAnimation(0, "release", loop: false, mix: 0.1f);
            rigbytron.AddAnimation(0, "hold", loop: true, mix: 0.3f);
        }
        if (Pressed(KeyCode.F)) rigbytron.FlipX = !rigbytron.FlipX;
    }

    void OnGUI() => GUI.Label(new Rect(16, 12, 600, 24), last);
}
