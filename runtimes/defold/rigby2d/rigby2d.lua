-- SPDX-License-Identifier: MIT OR Apache-2.0
-- Rigby2D for Defold: plays a Rigby2D skeleton (.json or .skel with its .atlas and page images)
-- from a game object. The native `rigby` module does the work; this file keeps the mesh pieces
-- that draw it (one per run of atlas page, spawned from /rigby2d/piece.go by a factory).
--
--   local rigby2d = require("rigby2d.rigby2d")
--   function init(self)
--     self.hero = rigby2d.new({ skeleton = "/assets/hero.skel", atlas = "/assets/hero.atlas", animation = "idle" })
--   end
--   function update(self, dt) self.hero:update(dt) end
--   function final(self) self.hero:delete() end
--
-- The skeleton, atlas and page images are read with sys.load_resource, so list their folder in
-- game.project's custom_resources. The game object needs a factory (default "#rigby2d")
-- with the prototype /rigby2d/piece.go.

local M = {}

local STREAMS = {
	{ name = hash("position"), type = buffer.VALUE_TYPE_FLOAT32, count = 3 },
	{ name = hash("texcoord0"), type = buffer.VALUE_TYPE_FLOAT32, count = 2 },
	{ name = hash("color"), type = buffer.VALUE_TYPE_FLOAT32, count = 4 },
	{ name = hash("dark"), type = buffer.VALUE_TYPE_FLOAT32, count = 4 },
}

-- Skeleton data and page textures, shared by every player of the same files.
local cache = {}
local next_id = 0

local function unique(prefix)
	next_id = next_id + 1
	return "/rigby2d/" .. prefix .. next_id
end

local function read(path)
	local bytes, err = sys.load_resource(path)
	if not bytes then
		error("rigby2d: can't read " .. path .. " (" .. tostring(err) .. "); is its folder in custom_resources?")
	end
	return bytes
end

local function dir_of(path)
	return path:match("^(.*/)") or ""
end

--- Page textures of an atlas (its images sit in `dir`): { textures, pma } by page.
local function load_pages(pages, dir)
	local out = { textures = {}, pma = {} }
	for i, page in ipairs(pages) do
		local img = image.load_buffer(read(dir .. page.name), { premultiply_alpha = false })
		if not img then
			error("rigby2d: can't decode atlas page " .. dir .. page.name)
		end
		out.textures[i] = resource.create_texture(unique("page") .. ".texturec", {
			type = graphics.TEXTURE_TYPE_2D,
			width = img.width,
			height = img.height,
			format = img.type == image.TYPE_RGB and graphics.TEXTURE_FORMAT_RGB or graphics.TEXTURE_FORMAT_RGBA,
		}, img.buffer)
		out.pma[i] = page.pma and 1 or 0
	end
	return out
end

--- Loads (once) a skeleton with its atlas and page textures.
-- @param skeleton string path of the .json or .skel file
-- @param atlas string path of the .atlas file (its page images sit next to it)
-- @return table { data, textures, pma }
function M.load(skeleton, atlas)
	local key = skeleton .. "|" .. atlas
	local loaded = cache[key]
	if loaded then
		loaded.users = loaded.users + 1
		return loaded
	end
	local data, err = rigby.load(read(skeleton), read(atlas))
	if not data then
		error("rigby2d: " .. skeleton .. ": " .. err)
	end
	loaded = load_pages(data:pages(), dir_of(atlas))
	loaded.key = key
	loaded.data = data
	loaded.users = 1
	cache[key] = loaded
	return loaded
end

local function release_pages(pages)
	for _, texture in ipairs(pages.textures) do
		resource.release(texture)
	end
end

local function unload(loaded)
	loaded.users = loaded.users - 1
	if loaded.users > 0 then
		return
	end
	cache[loaded.key] = nil
	release_pages(loaded)
end

local Player = {}
Player.__index = Player

--- Creates a player on the current game object.
-- @param options table:
--   skeleton, atlas (paths, required); animation (played looping on track 0); skin;
--   factory (url of the piece factory, default "#rigby2d"); speed.
function M.new(options)
	local self = setmetatable({}, Player)
	self.loaded = M.load(assert(options.skeleton, "rigby2d: skeleton path missing"), assert(options.atlas, "rigby2d: atlas path missing"))
	self.data = self.loaded.data
	self.skeleton = rigby.new(self.data)
	self.factory = options.factory or msg.url("#rigby2d")
	self.owner = go.get_id()
	self.pieces = {}
	self.listeners = {}
	if options.skin then
		self:set_skin(options.skin)
	end
	if options.speed then
		self.skeleton:set_speed(options.speed)
	end
	if options.animation then
		self:play(options.animation, options.loop ~= false)
	end
	self:update(0)
	return self
end

--- Plays an animation on track 0 (or `track`), crossfading over `mix` seconds.
function Player:play(name, loop, mix, track)
	local id = self.skeleton:set_animation(track or 0, name, loop ~= false, mix or 0)
	if not id then
		print("rigby2d: no animation '" .. tostring(name) .. "'")
	end
	return id
end

--- Starts an animation on a track now. Returns the entry id, or nil when there is no such animation.
function Player:set_animation(track, name, loop, mix)
	return self.skeleton:set_animation(track, name, loop, mix or 0)
end

--- Queues an animation after the current one on a track: when it ends, or `delay` seconds after it starts.
function Player:add_animation(track, name, loop, mix, delay)
	return self.skeleton:add_animation(track, name, loop, mix or 0, delay)
end

function Player:clear_track(track)
	self.skeleton:clear_track(track)
end

function Player:stop()
	self.skeleton:stop()
end

--- Name and time of the animation playing on a track, or nil.
function Player:current(track)
	return self.skeleton:current(track or 0)
end

function Player:set_track_alpha(track, alpha)
	self.skeleton:set_track_alpha(track, alpha)
end

function Player:set_track_time_scale(track, scale)
	self.skeleton:set_track_time_scale(track, scale)
end

function Player:set_speed(speed)
	self.skeleton:set_speed(speed)
end

function Player:set_skin(name)
	local found = self.skeleton:set_skin(name)
	if not found then
		print("rigby2d: no skin '" .. tostring(name) .. "'")
	end
	return found
end

--- Multiplies every color (r, g, b, a in 0..1).
function Player:set_tint(r, g, b, a)
	self.skeleton:set_tint(r, g, b, a)
end

--- Calls fn(event) for every playback event: event.kind is "start", "end", "complete" or "event"
-- (an event key: name, time, int, float, string, audio, volume, balance); track and animation
-- name are always set.
function Player:on_event(fn)
	table.insert(self.listeners, fn)
end

--- Position (x, y), rotation (degrees) and scale of a bone, in the game object's space.
function Player:bone(name)
	return self.skeleton:bone(name)
end

--- Moves a bone to a position in the game object's space for this frame (call after update,
-- before draw; update(dt) calls draw itself, so use update(dt, true) then draw()).
function Player:set_bone(name, x, y)
	self.skeleton:set_bone(name, x, y)
end

--- Names in the skeleton.
function Player:animations() return self.data:animations() end
function Player:skins() return self.data:skins() end
function Player:bones() return self.data:bones() end
function Player:events() return self.data:events() end
function Player:duration(name) return self.data:duration(name) end

local function grow(piece, vertices)
	local capacity = math.max(64, piece.capacity or 0)
	while capacity < vertices do
		capacity = capacity * 2
	end
	piece.buffer = buffer.create(capacity, STREAMS)
	piece.capacity = capacity
	piece.written = 0
	local path = unique("piece") .. ".bufferc"
	local resource_path = resource.create_buffer(path, { buffer = piece.buffer, transfer_ownership = false })
	go.set(piece.mesh, "vertices", resource_path)
	if piece.resource then
		resource.release(piece.resource)
	end
	piece.resource = resource_path
end

local function new_piece(self, index)
	-- Scale 1: a spawned object otherwise takes the owner's scale, which parenting applies again.
	local id = factory.create(self.factory, vmath.vector3(0, 0, index * 0.0001), vmath.quat(), nil, 1)
	go.set_parent(id, self.owner, false)
	local piece = { id = id, mesh = msg.url(nil, id, "mesh") }
	self.pieces[index] = piece
	return piece
end

--- Builds the geometry of `native` (a skeleton or a scene) and writes it into the mesh pieces.
-- `sources` holds the page textures of each skeleton it draws from (one for a skeleton).
local function draw_pieces(self, native, sources)
	local count = native:build()
	for i = 1, count do
		local page, vertices, source = native:piece(i)
		local piece = self.pieces[i] or new_piece(self, i)
		if piece.hidden then
			msg.post(piece.mesh, "enable")
			piece.hidden = false
		end
		if not piece.capacity or vertices > piece.capacity then
			grow(piece, vertices)
		end
		if piece.page ~= page or piece.source ~= source then
			piece.page = page
			piece.source = source
			local pages = sources[source]
			go.set(piece.mesh, "texture0", pages.textures[page])
			go.set(piece.mesh, "pma", vmath.vector4(pages.pma[page], 0, 0, 0))
		end
		piece.written = native:write(i, piece.buffer, piece.written)
		resource.set_buffer(piece.resource, piece.buffer)
	end
	for i = count + 1, #self.pieces do
		local piece = self.pieces[i]
		if not piece.hidden then
			msg.post(piece.mesh, "disable")
			piece.hidden = true
		end
	end
end

local function delete_pieces(self)
	for _, piece in ipairs(self.pieces) do
		go.delete(piece.id)
		if piece.resource then
			resource.release(piece.resource)
		end
	end
	self.pieces = {}
end

--- Writes the current pose into the mesh pieces.
function Player:draw()
	self.sources = self.sources or { self.loaded }
	draw_pieces(self, self.skeleton, self.sources)
end

--- Advances playback by dt seconds, reports events and draws the new pose (unless no_draw).
function Player:update(dt, no_draw)
	local events = self.skeleton:update(dt)
	if events and #self.listeners > 0 then
		for _, event in ipairs(events) do
			for _, fn in ipairs(self.listeners) do
				fn(event)
			end
		end
	end
	if not no_draw then
		self:draw()
	end
	return events
end

--- Deletes the mesh pieces and releases resources. Call from final().
function Player:delete()
	delete_pieces(self)
	if self.loaded then
		unload(self.loaded)
		self.loaded = nil
	end
end

-- ---- scenes -------------------------------------------------------------------------------------

local ScenePlayer = {}
ScenePlayer.__index = ScenePlayer

--- Plays a scene exported with File > Export > Scene for runtimes (<name>.scene.json, with the
-- stage and every character's skeleton, .atlas and pages next to it) on the current game object.
-- @param options table:
--   scene (path of the .scene.json, required); shot (default: the first); loop (default true);
--   factory (url of the piece factory, default "#rigby2d"); playing (default true).
function M.new_scene(options)
	local self = setmetatable({}, ScenePlayer)
	local path = assert(options.scene, "rigby2d: scene path missing")
	local dir = dir_of(path)
	local scene, err = rigby.load_scene(read(path), function(file)
		return sys.load_resource(dir .. file)
	end)
	if not scene then
		error("rigby2d: " .. path .. ": " .. tostring(err))
	end
	self.scene = scene
	self.factory = options.factory or msg.url("#rigby2d")
	self.owner = go.get_id()
	self.pieces = {}
	self.listeners = {}
	self.playing = options.playing ~= false
	-- Each skeleton's atlas is <skeleton without extension>.atlas next to it (a stage without
	-- images has none).
	self.sources = {}
	for i, file in ipairs(scene:sources()) do
		local atlas = dir .. file:gsub("%.[^./]*$", "") .. ".atlas"
		local text = sys.load_resource(atlas)
		if text then
			scene:set_atlas(i, text)
			self.sources[i] = load_pages(scene:pages(i), dir_of(atlas))
		else
			self.sources[i] = { textures = {}, pma = {} }
		end
	end
	local shot = options.shot or scene:shots()[1]
	if shot then
		self:play(shot, options.loop ~= false)
	end
	self:draw()
	return self
end

--- Plays a shot (a stage animation) from its start. Returns false if there is no such shot.
function ScenePlayer:play(shot, loop)
	local found = self.scene:play(shot, loop ~= false)
	if not found then
		print("rigby2d: no shot '" .. tostring(shot) .. "'")
	end
	return found
end

--- Calls fn(shot) each time the shot reaches its end (every loop, or once when it holds).
function ScenePlayer:on_finished(fn)
	table.insert(self.listeners, fn)
end

--- Jumps to `seconds` into the current shot.
function ScenePlayer:seek(seconds)
	self.scene:seek(seconds)
	self:draw()
end

--- Shot name, seconds into it, and its length.
function ScenePlayer:current() return self.scene:current() end
function ScenePlayer:shots() return self.scene:shots() end
function ScenePlayer:actors() return self.scene:actors() end

--- The stage's camera bone (x, y, rotation, scale_x, scale_y in the game object's space): follow
-- it with a camera, or move the game object the other way.
function ScenePlayer:camera()
	return self.scene:stage_bone("camera")
end

--- A stage bone, or a bone of an actor: x, y, rotation, scale_x, scale_y in the game object's space.
function ScenePlayer:stage_bone(name) return self.scene:stage_bone(name) end
function ScenePlayer:actor_bone(actor, bone) return self.scene:actor_bone(actor, bone) end

--- Writes the current frame into the mesh pieces.
function ScenePlayer:draw()
	draw_pieces(self, self.scene, self.sources)
end

--- Advances the scene by dt seconds (when playing) and draws it.
function ScenePlayer:update(dt)
	if self.playing and self.scene:update(dt) then
		local shot = self.scene:current()
		for _, fn in ipairs(self.listeners) do
			fn(shot)
		end
	end
	self:draw()
end

--- Deletes the mesh pieces and releases the page textures. Call from final().
function ScenePlayer:delete()
	delete_pieces(self)
	for _, pages in ipairs(self.sources) do
		release_pages(pages)
	end
	self.sources = {}
end

return M
