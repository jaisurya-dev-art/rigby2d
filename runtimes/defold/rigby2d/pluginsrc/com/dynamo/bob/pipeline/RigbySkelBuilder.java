// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds a Rigby2D skeleton (.rigbyskel: a binary .skel exported from Rigby2D) for the engine: the
// bytes as they are. Bob finds builders in this package of an extension's plugin jar.
package com.dynamo.bob.pipeline;

import com.dynamo.bob.BuilderParams;
import com.dynamo.bob.CopyBuilder;

@BuilderParams(name = "RigbySkel", inExts = ".rigbyskel", outExt = ".rigbyskelc")
public class RigbySkelBuilder extends CopyBuilder {}
