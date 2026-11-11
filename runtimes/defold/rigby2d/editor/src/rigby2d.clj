;; SPDX-License-Identifier: MIT OR Apache-2.0
;; Rigby2D for the Defold editor: the .rigbyskel (skeleton) and .rigbymodel (component) resource
;; types, with a live preview. The scene view plays the model through the Rigby2D runtime itself
;; (pluginsrc/plugin.cpp, reached with com.rigby2d.defold.Rigby2DPlugin), so it moves exactly as it
;; will in the game: pick an animation and a skin in the properties and press Play in the scene view.

(ns editor.rigby2d
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [dynamo.graph :as g]
            [editor.build-target :as bt]
            [editor.defold-project :as project]
            [editor.geom :as geom]
            [editor.gl :as gl]
            [editor.gl.pass :as pass]
            [editor.gl.shader :as shader]
            [editor.gl.texture :as texture]
            [editor.gl.vertex2 :as vtx2]
            [editor.graph-util :as gu]
            [editor.localization :as localization]
            [editor.material :as material]
            [editor.math :as math]
            [editor.outline :as outline]
            [editor.properties :as properties]
            [editor.protobuf :as protobuf]
            [editor.render-util :as render-util]
            [editor.resource :as resource]
            [editor.resource-node :as resource-node]
            [editor.scene-picking :as scene-picking]
            [editor.shaders :as shaders]
            [editor.types :as types]
            [editor.validation :as validation]
            [editor.workspace :as workspace])
  (:import [com.jogamp.opengl GL GL2]
           [editor.gl.shader ShaderLifecycle]
           [editor.types AABB]
           [java.lang.reflect InvocationTargetException]
           [java.nio ByteBuffer]
           [javax.vecmath Matrix4d Vector4d]
           [org.apache.commons.io IOUtils]))

(def ^:private skel-ext "rigbyskel")
(def ^:private model-ext "rigbymodel")
(def ^:private default-material "/rigby2d/materials/rigby2d_model.material")
(def ^:private skel-icon "/rigby2d/editor/resources/icons/32/rigby2d-skeleton.png")
(def ^:private model-icon "/rigby2d/editor/resources/icons/32/rigby2d-model.png")

(def ^:private plugin-cls (workspace/load-class! "com.rigby2d.defold.Rigby2DPlugin"))
(def ^:private model-cls (workspace/load-class! "com.rigby2d.defold.Rigby2DPlugin$Model"))
(def ^:private model-desc-cls (workspace/load-class! "com.rigby2d.defold.proto.Rigby2D$RigbyModelDesc"))
(def ^:private byte-array-cls (Class/forName "[B"))

;; ---- runtime bridge -------------------------------------------------------------------------------

(defn- invoke [name types args]
  (try
    (.invoke (.getMethod ^Class plugin-cls name (into-array Class types)) nil (into-array Object args))
    (catch InvocationTargetException e
      (throw (or (.getCause e) e)))))

(defn- load-model [skeleton-bytes texture-set-bytes]
  (invoke "load" [byte-array-cls byte-array-cls] [skeleton-bytes texture-set-bytes]))

(defn- model-animations [model] (vec (invoke "animations" [model-cls] [model])))
(defn- model-skins [model] (vec (invoke "skins" [model-cls] [model])))
(defn- model-missing [model] (vec (invoke "missingImages" [model-cls] [model])))
(defn- model-set-animation! [model ^String animation loop?]
  (invoke "RIGBY_SetAnimation" [model-cls String Integer/TYPE] [model (or animation "") (int (if loop? 1 0))]))
(defn- model-set-skin! [model ^String skin]
  (invoke "RIGBY_SetSkin" [model-cls String] [model (or skin "")]))
(defn- model-update! [model dt]
  (invoke "RIGBY_Update" [model-cls Float/TYPE] [model (float dt)]))
(defn- model-vertices ^ByteBuffer [model]
  (invoke "vertices" [model-cls] [model]))
(defn- model-bounds [model]
  (invoke "bounds" [model-cls] [model]))

(defn- resource->bytes [resource]
  (with-open [in (io/input-stream resource)]
    (IOUtils/toByteArray in)))

;; ---- .rigbyskel -----------------------------------------------------------------------------------

(defn- load-skeleton [_load-opts {:keys [node-id resource]}]
  (let [content (resource->bytes resource)
        ;; Read without an atlas: just the names the model's properties offer.
        model (try (load-model content nil) (catch Exception _ nil))]
    (concat
      (g/set-property node-id :content content)
      (g/set-property node-id :animations (if model (sort (model-animations model)) []))
      (g/set-property node-id :skins (if model (sort (model-skins model)) [])))))

(defn- build-skeleton [resource _dep-resources user-data]
  {:resource resource :content (:content user-data)})

(g/defnk produce-skeleton-build-targets [_node-id resource content]
  [(bt/with-content-hash
     {:node-id _node-id
      :resource (workspace/make-build-resource resource)
      :build-fn build-skeleton
      :user-data {:content content
                  :content-hash (resource/resource->sha1-hex resource)}})])

(g/defnode RigbySkeletonNode
  (inherits resource-node/ResourceNode)
  (property content g/Any)
  (property animations g/Any)
  (property skins g/Any)
  (output build-targets g/Any :cached produce-skeleton-build-targets))

;; ---- rendering ------------------------------------------------------------------------------------

;; Matches rigby::ModelVertex (rigby_defold.h) and the rigby2d material's attributes.
(vtx2/defvertex rigby-vertex
  (vec3 position)
  (vec2 texcoord0)
  (vec4 color)
  (vec4 dark))

(defn- render-transforms [renderable render-args]
  (math/derive-render-transforms (:world-transform renderable)
                                 (:view render-args)
                                 (:projection render-args)
                                 (:texture render-args)))

(defn- render-model [^GL2 gl render-args renderable selection?]
  (let [{:keys [model shader gpu-texture]} (:user-data renderable)
        ^ByteBuffer vertices (model-vertices model)
        vertex-count (quot (.limit vertices) 52)]
    (when (pos? vertex-count)
      (let [shader (if selection? shaders/selection-uniform-world-space shader)
            vb (vtx2/wrap-vertex-buffer rigby-vertex :static vertices)
            binding (vtx2/use-with [::rigby2d (:node-id renderable)] vb shader)
            transforms (render-transforms renderable render-args)
            render-args (cond-> (merge render-args transforms)
                          selection? (assoc :id-color (scene-picking/renderable-picking-id-uniform renderable)))]
        (gl/with-gl-bindings gl render-args [shader (or gpu-texture texture/white-pixel) binding]
          (if selection?
            (shader/set-uniform shader gl "mtx_world_view_proj" (:world-view-proj transforms))
            (do
              (shader/set-uniform shader gl "view_proj" (:world-view-proj transforms))
              ;; Defold atlases are premultiplied; the shader writes straight alpha.
              (shader/set-uniform shader gl "pma" (Vector4d. 1.0 0.0 0.0 0.0))
              (.glBlendFunc gl GL/GL_SRC_ALPHA GL/GL_ONE_MINUS_SRC_ALPHA)))
          (gl/gl-draw-arrays gl GL/GL_TRIANGLES 0 vertex-count)
          (when-not selection?
            (gl/set-blend-mode gl :blend-mode-alpha)))))))

(defn- render-models [^GL2 gl render-args renderables _rcount]
  (let [pass (:pass render-args)]
    (cond
      (= pass pass/transparent) (run! #(render-model gl render-args % false) renderables)
      (= pass pass/selection) (run! #(render-model gl render-args % true) renderables))))

;; ---- .rigbymodel ----------------------------------------------------------------------------------

(defn- prop-resource-error [_node-id prop-kw prop-value prop-name]
  (or (validation/prop-error :fatal _node-id prop-kw validation/prop-nil? prop-value prop-name)
      (validation/prop-error :fatal _node-id prop-kw validation/prop-resource-not-exists? prop-value prop-name)))

(defn- validate-name [_node-id prop-kw value names what]
  (when (and (not (str/blank? value)) (seq names) (not (some #{value} names)))
    (g/->error _node-id prop-kw :fatal value (format "the skeleton has no %s '%s'" what value))))

(g/defnk produce-model-pb [skeleton atlas default-animation skin material playback-rate loop]
  (protobuf/make-map-without-defaults model-desc-cls
    :skeleton (resource/resource->proj-path skeleton)
    :atlas (resource/resource->proj-path atlas)
    :default-animation default-animation
    :skin skin
    :material (resource/resource->proj-path material)
    :playback-rate playback-rate
    :loop loop))

(g/defnk produce-own-build-errors [_node-id skeleton atlas material default-animation skin animations skins]
  (g/package-errors _node-id
    (prop-resource-error _node-id :skeleton skeleton "Skeleton")
    (prop-resource-error _node-id :atlas atlas "Atlas")
    (prop-resource-error _node-id :material material "Material")
    (validate-name _node-id :default-animation default-animation animations "animation")
    (validate-name _node-id :skin skin skins "skin")))

(defn- build-model [resource dep-resources user-data]
  (let [pb (reduce (fn [pb [field dep]] (assoc pb field (resource/proj-path (get dep-resources dep))))
                   (:pb user-data)
                   (:deps user-data))]
    {:resource resource :content (protobuf/map->bytes model-desc-cls pb)}))

(g/defnk produce-model-build-targets [_node-id own-build-errors resource model-pb skeleton atlas material dep-build-targets]
  (g/precluding-errors own-build-errors
    (let [dep-build-targets (flatten dep-build-targets)
          by-source (into {} (map (fn [t] [(-> t :resource :resource) (:resource t)])) dep-build-targets)
          deps (keep (fn [[field res]] (when-let [built (get by-source res)] [field built]))
                     [[:skeleton skeleton] [:atlas atlas] [:material material]])]
      [(bt/with-content-hash
         {:node-id _node-id
          :resource (workspace/make-build-resource resource)
          :build-fn build-model
          :user-data {:pb model-pb :deps deps}
          :deps dep-build-targets})])))

;; The playing model: reloaded when the skeleton or atlas changes, restarted when the animation or
;; skin does. The native object is freed by the garbage collector.
(g/defnk produce-model [_node-id skeleton-content texture-set-pb default-animation skin loop]
  (when skeleton-content
    (try
      (let [model (load-model skeleton-content texture-set-pb)]
        (model-set-skin! model skin)
        (model-set-animation! model default-animation loop)
        model)
      (catch Throwable e
        (.println System/err (str "Rigby2D: couldn't load the model: " e))
        (g/->error _node-id :skeleton :fatal nil (str "Couldn't read the skeleton: " (.getMessage e)))))))

(g/defnk produce-aabb [model]
  (if (and model (not (g/error? model)))
    (let [_ (model-vertices model) ; bounds come from a build
          [x0 y0 x1 y1] (vec (model-bounds model))]
      (if (and (< x0 x1) (< y0 y1))
        (geom/coords->aabb [x0 y0 0] [x1 y1 0])
        geom/empty-bounding-box))
    geom/empty-bounding-box))

(g/defnk produce-updatable [_node-id model playback-rate]
  (when (and model (not (g/error? model)))
    {:node-id _node-id
     :name "Rigby2D Model"
     :update-fn (fn [state {:keys [dt]}]
                  (model-update! model (* dt playback-rate))
                  state)
     :initial-state {}}))

(g/defnk produce-scene [_node-id aabb model material-shader gpu-texture tex-params updatable]
  (if (and model (not (g/error? model)) material-shader)
    {:node-id _node-id
     :aabb aabb
     :updatable updatable
     :renderable {:render-fn render-models
                  :tags #{:rigby2d}
                  :batch-key _node-id
                  :select-batch-key _node-id
                  :user-data {:model model
                              :shader material-shader
                              :gpu-texture (when gpu-texture (texture/set-params gpu-texture tex-params))}
                  :passes [pass/transparent pass/selection]}
     :children [{:node-id _node-id
                 :aabb aabb
                 :renderable (render-util/make-aabb-outline-renderable #{:rigby2d})}]}
    {:node-id _node-id
     :aabb geom/empty-bounding-box
     :renderable {:passes [pass/selection]}}))

(defn- load-rigby-model [{:keys [project resolve-resource-fn]} {:keys [owner-resource] self :node-id desc :source-value}]
  (let [resolve #(resolve-resource-fn owner-resource %)]
    (concat
      (g/connect project :default-tex-params self :default-tex-params)
      (gu/set-properties-from-pb-map self model-desc-cls desc
        skeleton (resolve :skeleton)
        atlas (resolve :atlas)
        default-animation :default-animation
        skin :skin
        material (resolve (:material :or default-material))
        playback-rate :playback-rate
        loop :loop))))

(g/defnode RigbyModelNode
  (inherits resource-node/ResourceNode)

  (property skeleton resource/Resource
            (value (gu/passthrough skeleton-resource))
            (set (fn [evaluation-context self old-value new-value]
                   (project/resource-setter evaluation-context self old-value new-value
                                            [:resource :skeleton-resource]
                                            [:content :skeleton-content]
                                            [:animations :animations]
                                            [:skins :skins]
                                            [:build-targets :dep-build-targets])))
            (dynamic edit-type (g/constantly {:type resource/Resource :ext skel-ext}))
            (dynamic error (g/fnk [_node-id skeleton] (prop-resource-error _node-id :skeleton skeleton "Skeleton"))))
  (property atlas resource/Resource
            (value (gu/passthrough atlas-resource))
            (set (fn [evaluation-context self old-value new-value]
                   (project/resource-setter evaluation-context self old-value new-value
                                            [:resource :atlas-resource]
                                            [:texture-set-pb :texture-set-pb]
                                            [:gpu-texture :gpu-texture]
                                            [:build-targets :dep-build-targets])))
            (dynamic edit-type (g/constantly {:type resource/Resource :ext "atlas"}))
            (dynamic error (g/fnk [_node-id atlas] (prop-resource-error _node-id :atlas atlas "Atlas"))))
  (property default-animation g/Str (default "")
            (dynamic label (g/constantly "Animation"))
            (dynamic edit-type (g/fnk [animations] (properties/->choicebox (cons "" animations))))
            (dynamic error (g/fnk [_node-id default-animation animations]
                             (validate-name _node-id :default-animation default-animation animations "animation"))))
  (property skin g/Str (default "")
            (dynamic edit-type (g/fnk [skins] (properties/->choicebox (cons "" (remove #{"default"} skins)))))
            (dynamic error (g/fnk [_node-id skin skins] (validate-name _node-id :skin skin skins "skin"))))
  (property loop g/Bool (default true))
  (property playback-rate g/Num (default 1.0))
  (property material resource/Resource
            (value (gu/passthrough material-resource))
            (set (fn [evaluation-context self old-value new-value]
                   (project/resource-setter evaluation-context self old-value new-value
                                            [:resource :material-resource]
                                            [:shader :material-shader]
                                            [:samplers :material-samplers]
                                            [:build-targets :dep-build-targets])))
            (dynamic edit-type (g/constantly {:type resource/Resource :ext "material"}))
            (dynamic error (g/fnk [_node-id material] (prop-resource-error _node-id :material material "Material"))))

  (input skeleton-resource resource/Resource)
  (input skeleton-content g/Any)
  (input animations g/Any)
  (input skins g/Any)
  (input atlas-resource resource/Resource)
  (input texture-set-pb g/Any)
  (input gpu-texture g/Any)
  (input material-resource resource/Resource)
  (input material-shader ShaderLifecycle)
  (input material-samplers g/Any)
  (input default-tex-params g/Any)
  (input dep-build-targets g/Any :array)

  (output tex-params g/Any (g/fnk [material-samplers default-tex-params]
                             (or (some-> material-samplers first material/sampler->tex-params)
                                 default-tex-params)))
  (output model g/Any :cached produce-model)
  (output aabb AABB :cached produce-aabb)
  (output updatable g/Any :cached produce-updatable)
  (output scene g/Any :cached produce-scene)
  (output model-pb g/Any produce-model-pb)
  (output save-value g/Any (gu/passthrough model-pb))
  (output own-build-errors g/Any produce-own-build-errors)
  (output build-targets g/Any :cached produce-model-build-targets)
  (output node-outline outline/OutlineData :cached
          (g/fnk [_node-id own-build-errors skeleton]
            (cond-> {:node-id _node-id
                     :node-outline-key "Rigby2D Model"
                     :label "Rigby2D Model"
                     :icon model-icon
                     :outline-error? (g/error-fatal? own-build-errors)}
              (resource/resource? skeleton) (assoc :link skeleton :outline-reference? false)))))

;; ---- registration ---------------------------------------------------------------------------------

(defn- register-resource-types [workspace]
  (concat
    (resource-node/register-ddf-resource-type workspace
      :ext model-ext
      :label "Rigby2D Model"
      :node-type RigbyModelNode
      :ddf-type model-desc-cls
      :load-fn load-rigby-model
      :icon model-icon
      :category (localization/message "resource.category.components")
      :view-types [:scene :text]
      :view-opts {:scene {:grid true}}
      :tags #{:component}
      :tag-opts {:component {:transform-properties #{:position :rotation :scale}}}
      :template "/rigby2d/editor/resources/templates/template.rigbymodel")
    (workspace/register-resource-type workspace
      :ext skel-ext
      :label "Rigby2D Skeleton"
      :node-type RigbySkeletonNode
      :textual? false
      :load-fn load-skeleton
      :icon skel-icon
      :view-types [:default])))

(defn- load-plugin-rigby2d [workspace]
  (g/transact (register-resource-types workspace)))

(defn return-plugin []
  (fn [workspace] (load-plugin-rigby2d workspace)))

(return-plugin)
