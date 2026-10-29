// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D skeleton shader: two-color tint, straight or premultiplied atlas pages, every blend mode,
// correct in both Gamma and Linear color space.
//
// Atlas pages are imported as raw data (sRGB off, see RigbyTextureImport), so the shader sees the
// exact pixels the editor painted. It undoes premultiplication when the page has it, converts to
// linear itself in Linear projects, applies the tint, and outputs premultiplied alpha. That is the
// order that keeps edges clean: sampling sRGB or premultiplied pages through the GPU's own sRGB
// decode is what gives dark or bright fringes. Works in the Built-in and Universal render pipelines
// (an unlit pass with no LightMode is drawn by both).
Shader "Rigby2D/Skeleton"
{
    Properties
    {
        [NoScaleOffset] _MainTex ("Atlas page", 2D) = "white" {}
        [Toggle] _Pma ("Page has premultiplied alpha", Float) = 0
        [HideInInspector] _SrcBlend ("Source blend", Float) = 1
        [HideInInspector] _DstBlend ("Destination blend", Float) = 10
        [HideInInspector] _Multiply ("Multiply blend", Float) = 0
        [HideInInspector] _Screen ("Screen blend", Float) = 0
        [Toggle] _AlphaClip ("Alpha clip (for depth or stencil masks)", Float) = 0
        _Cutoff ("Alpha clip threshold", Range(0, 1)) = 0.01
        [IntRange] _StencilRef ("Stencil reference", Range(0, 255)) = 0
        [Enum(UnityEngine.Rendering.CompareFunction)] _StencilComp ("Stencil compare", Float) = 8
    }

    SubShader
    {
        Tags { "Queue" = "Transparent" "IgnoreProjector" = "True" "RenderType" = "Transparent" "PreviewType" = "Plane" "CanUseSpriteAtlas" = "False" }
        Cull Off
        ZWrite Off
        Lighting Off
        Blend [_SrcBlend] [_DstBlend]

        Stencil
        {
            Ref [_StencilRef]
            Comp [_StencilComp]
            Pass Keep
        }

        Pass
        {
            Name "Rigby2D"
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float _Pma, _Multiply, _Screen, _AlphaClip, _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float4 color : COLOR;     // light color, straight alpha, sRGB values
                float2 uv : TEXCOORD0;
                float4 dark : TEXCOORD1;  // dark color for two-color tint; a = 1 when the slot has one
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                float4 dark : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.uv = v.uv;
                o.dark = v.dark;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                float4 t = tex2D(_MainTex, i.uv);
                // Straight color of the texel, in the space the art was painted in (sRGB).
                float3 c = _Pma > 0.5 ? (t.a > 0.0001 ? t.rgb / t.a : float3(0, 0, 0)) : t.rgb;
                // Two-color tint, as the editor does it: texture c maps to light * c + dark * (1 - c).
                float3 rgb = c * i.color.rgb + (1.0 - c) * i.dark.rgb * i.dark.a;
                float a = t.a * i.color.a;
                if (_AlphaClip > 0.5) clip(a - _Cutoff);
                #if !defined(UNITY_COLORSPACE_GAMMA)
                    rgb = GammaToLinearSpace(saturate(rgb));
                #endif
                // Premultiplied output; the blend factors of each mode expect it.
                if (_Multiply > 0.5) return float4(lerp(float3(1, 1, 1), rgb, a), 1.0);
                if (_Screen > 0.5)
                {
                    float3 p = rgb * a;
                    return float4(p, max(p.r, max(p.g, p.b)));
                }
                return float4(rgb * a, a);
            }
            ENDCG
        }
    }
    Fallback Off
}
