components {
  id: "loader"
  component: "/main/loader.script"
}
embedded_components {
  id: "characters"
  type: "collectionproxy"
  data: "collection: \"/main/characters.collection\"\n"
  ""
}
embedded_components {
  id: "scene"
  type: "collectionproxy"
  data: "collection: \"/main/scene.collection\"\n"
  ""
}
