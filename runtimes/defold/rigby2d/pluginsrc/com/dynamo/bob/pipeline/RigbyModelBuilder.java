// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds a Rigby2D model component (.rigbymodel) into .rigbymodelc: the skeleton, atlas and material
// it names are built as well, and its paths point at the built files.
package com.dynamo.bob.pipeline;

import java.io.IOException;

import com.dynamo.bob.BuilderParams;
import com.dynamo.bob.CompileExceptionError;
import com.dynamo.bob.ProtoBuilder;
import com.dynamo.bob.ProtoParams;
import com.dynamo.bob.Task;
import com.dynamo.bob.fs.IResource;
import com.rigby2d.defold.proto.Rigby2D.RigbyModelDesc;

@ProtoParams(srcClass = RigbyModelDesc.class, messageClass = RigbyModelDesc.class)
@BuilderParams(name = "RigbyModel", inExts = ".rigbymodel", outExt = ".rigbymodelc")
public class RigbyModelBuilder extends ProtoBuilder<RigbyModelDesc.Builder> {
    @Override
    public Task create(IResource input) throws IOException, CompileExceptionError {
        RigbyModelDesc.Builder source = getSrcBuilder(input);
        BuilderUtil.checkResource(project, input, "skeleton", source.getSkeleton());
        BuilderUtil.checkResource(project, input, "atlas", source.getAtlas());
        BuilderUtil.checkResource(project, input, "material", source.getMaterial());
        if (!source.getSkeleton().endsWith(".rigbyskel")) {
            throw new CompileExceptionError(input, 0, "skeleton must be a .rigbyskel file (a binary skeleton exported from Rigby2D)");
        }
        if (!source.getAtlas().endsWith(".atlas")) {
            throw new CompileExceptionError(input, 0, "atlas must be a Defold .atlas holding the skeleton's images");
        }
        Task.TaskBuilder<?> builder = Task.newBuilder(this)
                .setName(params.name())
                .addInput(input)
                .addOutput(input.changeExt(params.outExt()));
        createSubTasks(source, builder);
        return builder.build();
    }

    @Override
    protected RigbyModelDesc.Builder transform(Task task, IResource resource, RigbyModelDesc.Builder builder) {
        builder.setSkeleton(BuilderUtil.replaceExt(builder.getSkeleton(), ".rigbyskel", ".rigbyskelc"));
        builder.setAtlas(BuilderUtil.replaceExt(builder.getAtlas(), ".atlas", ".a.texturesetc"));
        builder.setMaterial(BuilderUtil.replaceExt(builder.getMaterial(), ".material", ".materialc"));
        return builder;
    }
}
