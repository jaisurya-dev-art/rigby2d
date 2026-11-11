// SPDX-License-Identifier: MIT OR Apache-2.0
// The Defold editor's bridge to the Rigby2D runtime (pluginsrc/plugin.cpp, built as the Rigby2D
// plugin library for each editor platform). editor/src/rigby2d.clj uses it to play a model in the
// scene view exactly as the game does.
package com.rigby2d.defold;

import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.PointerType;

public class Rigby2DPlugin {
    static {
        try {
            Native.register("Rigby2D");
        } catch (Throwable e) {
            System.out.println("Rigby2D: could not load the editor plugin library: " + e.getMessage());
        }
    }

    /** A loaded model (skeleton + atlas regions) with one playing instance. */
    public static class Model extends PointerType implements AutoCloseable {
        public Model() { super(); }
        public Model(Pointer p) { super(p); }

        @Override
        public synchronized void close() {
            if (getPointer() != null) {
                RIGBY_Destroy(this);
                setPointer(null);
            }
        }

        @Override
        protected void finalize() {
            close();
        }
    }

    public static class RigbyException extends Exception {
        public RigbyException(String message) { super(message); }
    }

    /** Bytes per vertex: position 3, texcoord0 2, color 4, dark 4, as float32. */
    public static final int VERTEX_SIZE = 13 * 4;

    public static native Pointer RIGBY_Load(Buffer skeleton, int skeletonSize, Buffer textureSet, int textureSetSize);
    public static native String RIGBY_GetLastError();
    public static native void RIGBY_Destroy(Model model);
    public static native int RIGBY_GetAnimationCount(Model model);
    public static native String RIGBY_GetAnimationName(Model model, int index);
    public static native int RIGBY_GetSkinCount(Model model);
    public static native String RIGBY_GetSkinName(Model model, int index);
    public static native int RIGBY_GetMissingCount(Model model);
    public static native String RIGBY_GetMissingName(Model model, int index);
    /** Plays an animation from its start ("" for the setup pose); 0 when there is no such animation. */
    public static native int RIGBY_SetAnimation(Model model, String animation, int loop);
    /** Shows a skin ("" for the default skin); 0 when there is no such skin. */
    public static native int RIGBY_SetSkin(Model model, String skin);
    public static native void RIGBY_Update(Model model, float dt);
    /** Builds the current pose's triangles (skeleton space); returns the vertex count. */
    public static native int RIGBY_BuildVertices(Model model);
    public static native Pointer RIGBY_GetVertices(Model model);
    /** Bounds of the last build: min x, min y, max x, max y. */
    public static native void RIGBY_GetBounds(Model model, float[] out);

    /** Loads a skeleton (.rigbyskel bytes) with a Defold atlas (TextureSet bytes, as the editor builds it). */
    public static synchronized Model load(byte[] skeleton, byte[] textureSet) throws RigbyException {
        ByteBuffer s = ByteBuffer.wrap(skeleton);
        ByteBuffer t = textureSet != null ? ByteBuffer.wrap(textureSet) : null;
        Pointer p = RIGBY_Load(s, s.capacity(), t, t != null ? t.capacity() : 0);
        if (p == null) throw new RigbyException(RIGBY_GetLastError());
        return new Model(p);
    }

    public static String[] animations(Model model) {
        String[] out = new String[RIGBY_GetAnimationCount(model)];
        for (int i = 0; i < out.length; i++) out[i] = RIGBY_GetAnimationName(model, i);
        return out;
    }

    public static String[] skins(Model model) {
        String[] out = new String[RIGBY_GetSkinCount(model)];
        for (int i = 0; i < out.length; i++) out[i] = RIGBY_GetSkinName(model, i);
        return out;
    }

    public static String[] missingImages(Model model) {
        String[] out = new String[RIGBY_GetMissingCount(model)];
        for (int i = 0; i < out.length; i++) out[i] = RIGBY_GetMissingName(model, i);
        return out;
    }

    /** The current pose's triangles as a vertex buffer (VERTEX_SIZE bytes each, native order). */
    public static synchronized ByteBuffer vertices(Model model) {
        int count = RIGBY_BuildVertices(model);
        Pointer p = RIGBY_GetVertices(model);
        if (p == null || count == 0) return ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder());
        ByteBuffer copy = ByteBuffer.allocateDirect(count * VERTEX_SIZE).order(ByteOrder.nativeOrder());
        copy.put(p.getByteBuffer(0, (long) count * VERTEX_SIZE));
        copy.flip();
        return copy;
    }

    public static float[] bounds(Model model) {
        float[] out = new float[4];
        RIGBY_GetBounds(model, out);
        return out;
    }
}
