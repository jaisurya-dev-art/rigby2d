components {
  id: "rigby2d_player"
  component: "/assets/rigbytron.script"
}
embedded_components {
  id: "rigby2d"
  type: "factory"
  data: "prototype: \"/rigby2d/piece.go\"\n"
  ""
}
embedded_components {
  id: "preview"
  type: "sprite"
  data: "default_animation: \"rigbytron_preview\"\n"
  "material: \"/builtins/materials/sprite.material\"\n"
  "textures {\n"
  "  sampler: \"texture_sampler\"\n"
  "  texture: \"/assets/rigbytron_preview.atlas\"\n"
  "}\n"
  ""
  position {
    x: -18.0169
    y: 656.8
  }
  scale {
    x: 1.3016
    y: 1.3016
    z: 1.0
  }
}
