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
	loaded = { key = key, data = data, textures = {}, pma = {}, users = 1 }
	for i, page in ipairs(data:pages()) do
		local img = image.load_buffer(read(dir_of(atlas) .. page.name), { premultiply_alpha = false })
		if not img then
			error("rigby2d: can't decode atlas page " .. page.name)
		end
		loaded.textures[i] = resource.create_texture(unique("page") .. ".texturec", {
			type = graphics.TEXTURE_TYPE_2D,
			width = img.width,
			height = img.height,
			format = img.type == image.TYPE_RGB and graphics.TEXTURE_FORMAT_RGB or graphics.TEXTURE_FORMAT_RGBA,
		}, img.buffer)
		loaded.pma[i] = page.pma and 1 or 0
	end
	cache[key] = loaded
	return loaded
end

local function unload(loaded)
	loaded.users = loaded.users - 1
	if loaded.users > 0 then
		return
	end
	cache[loaded.key] = nil
	for _, texture in ipairs(loaded.textures) do
		resource.release(texture)
	end
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
	local piece = { id = id, mesh = msg.url(nil, id, "mesh"), page = 0 }
	self.pieces[index] = piece
	return piece
end

--- Writes the current pose into the mesh pieces.
function Player:draw()
	local skeleton = self.skeleton
	local count = skeleton:build()
	for i = 1, count do
		local page, vertices = skeleton:piece(i)
		local piece = self.pieces[i] or new_piece(self, i)
		if piece.hidden then
			msg.post(piece.mesh, "enable")
			piece.hidden = false
		end
		if not piece.capacity or vertices > piece.capacity then
			grow(piece, vertices)
		end
		if piece.page ~= page then
			piece.page = page
			go.set(piece.mesh, "texture0", self.loaded.textures[page])
			go.set(piece.mesh, "pma", vmath.vector4(self.loaded.pma[page], 0, 0, 0))
		end
		piece.written = skeleton:write(i, piece.buffer, piece.written)
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
	for _, piece in ipairs(self.pieces) do
		go.delete(piece.id)
		if piece.resource then
			resource.release(piece.resource)
		end
	end
	self.pieces = {}
	if self.loaded then
		unload(self.loaded)
		self.loaded = nil
	end
end

return M
