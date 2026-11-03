#version 140
// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D skeleton pieces: two-color tint (texture c maps to light * c + dark * (1 - c)), straight
// or premultiplied-alpha pages, and the slot blend mode, packed in dark.a as has-dark + 2 * mode.
// The world pass of the default render script blends with SRC_ALPHA, ONE_MINUS_SRC_ALPHA: normal
// is exact; additive and screen add the color with its brightest channel as coverage (exact on
// dark backgrounds), multiply darkens by the color's grey level.
in mediump vec2 var_texcoord0;
in mediump vec4 var_color;
in mediump vec4 var_dark;

out vec4 out_fragColor;

uniform mediump sampler2D texture_sampler;

uniform fs_uniforms
{
    mediump vec4 pma;
};

void main()
{
    vec4 t = texture(texture_sampler, var_texcoord0);
    vec3 c = pma.x > 0.5 ? (t.a > 0.0 ? t.rgb / t.a : vec3(0.0)) : t.rgb;
    float a = t.a * var_color.a;
    float flags = floor(var_dark.a + 0.5);
    float has_dark = mod(flags, 2.0);
    float mode = floor(flags / 2.0);
    vec3 rgb = c * var_color.rgb + (vec3(1.0) - c) * var_dark.rgb * has_dark;
    if (mode < 0.5) {
        out_fragColor = vec4(rgb, a);
    } else if (mode > 1.5 && mode < 2.5) {
        out_fragColor = vec4(0.0, 0.0, 0.0, a * (1.0 - (rgb.r + rgb.g + rgb.b) / 3.0));
    } else {
        float m = max(rgb.r, max(rgb.g, rgb.b));
        out_fragColor = m > 0.0 ? vec4(rgb / m, a * m) : vec4(0.0);
    }
}
