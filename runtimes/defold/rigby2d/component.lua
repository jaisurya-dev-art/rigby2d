-- SPDX-License-Identifier: MIT OR Apache-2.0
-- Rigby2D game objects for Defold: the code behind the .go and .script that Rigby2D writes with
-- File > Export > Defold game object. The .go shows the character in the Defold editor (a sprite
-- named "preview" with a picture of its setup pose); in the game this hides the sprite and plays the
-- skeleton with rigby2d.lua, set up from the script's properties:
--
--   animation (hash)  animation looping on track 0 at start ("" for none)
--   skin (hash)       skin to show ("" for the default skin)
--   loop (bool)       whether that animation loops
--   speed (number)    playback speed
--
-- Other scripts drive it with messages to the script ("hero#rigby2d_player"):
--
--   msg.post("hero#rigby2d_player", "play", { animation = "run", loop = true, mix = 0.2, track = 0 })
--   msg.post("hero#rigby2d_player", "add_animation", { animation = "idle", loop = true, mix = 0.2, delay = 0 })
--   msg.post("hero#rigby2d_player", "stop")  -- also "clear_track" { track }, "set_skin" { skin },
--                                             -- "set_speed" { speed }, "set_tint" { r, g, b, a }
--
-- or call the player itself (same game world): require("rigby2d.component").player("hero"):play("run").
-- Playback events go to every component of the game object as "rigby2d_event" messages, with the
-- fields of rigby2d.lua's events (kind, track, animation, name...).

local rigby2d = require("rigby2d.rigby2d")

local M = {}

-- Players by game object id, for M.player.
local players = {}

local MSG_PLAY = hash("play")
local MSG_SET_ANIMATION = hash("set_animation")
local MSG_ADD_ANIMATION = hash("add_animation")
local MSG_CLEAR_TRACK = hash("clear_track")
local MSG_STOP = hash("stop")
local MSG_SET_SKIN = hash("set_skin")
local MSG_SET_SPEED = hash("set_speed")
local MSG_SET_TINT = hash("set_tint")
local EMPTY = hash("")

--- The name in `names` whose hash is `h` (script properties hold hashes), or nil.
local function unhash(names, h)
	if h == nil or h == EMPTY then
		return nil
	end
	for _, name in ipairs(names) do
		if hash(name) == h then
			return name
		end
	end
	return nil
end

--- A name from a message field: a string, or a hash of one of `names`.
local function name_of(names, value)
	if type(value) == "string" then
		return value
	end
	return unhash(names, value)
end

--- The player of a Rigby2D game object (its id or url, default the current game object), or nil.
function M.player(id)
	if id == nil then
		id = go.get_id()
	elseif type(id) == "string" then
		id = go.get_id(id)
	else
		-- A url gives its game object; a hash is the id already.
		local ok, path = pcall(function() return id.path end)
		if ok and path then
			id = path
		end
	end
	return players[id]
end

--- Script callbacks for a skeleton: options.skeleton and options.atlas (project paths),
-- options.preview (whether the game object has the "preview" sprite).
function M.new(options)
	local c = {}

	function c.init(self)
		if options.preview then
			msg.post("#preview", "disable")
		end
		local player = rigby2d.new({ skeleton = options.skeleton, atlas = options.atlas, speed = self.speed })
		self.player = player
		local skin = unhash(player:skins(), self.skin)
		if skin then
			player:set_skin(skin)
		elseif self.skin ~= EMPTY then
			print("rigby2d: " .. options.skeleton .. " has no skin with the hash " .. tostring(self.skin))
		end
		local animation = unhash(player:animations(), self.animation)
		if animation then
			player:play(animation, self.loop)
		elseif self.animation ~= EMPTY then
			print("rigby2d: " .. options.skeleton .. " has no animation with the hash " .. tostring(self.animation))
		end
		player:on_event(function(event)
			msg.post(".", "rigby2d_event", event)
		end)
		player:update(0)
		players[go.get_id()] = player
	end

	function c.update(self, dt)
		self.player:update(dt)
	end

	function c.on_message(self, message_id, message)
		local player = self.player
		if message_id == MSG_PLAY or message_id == MSG_SET_ANIMATION then
			local name = name_of(player:animations(), message.animation)
			if name then
				player:set_animation(message.track or 0, name, message.loop ~= false, message.mix or 0)
			else
				print("rigby2d: no animation " .. tostring(message.animation))
			end
		elseif message_id == MSG_ADD_ANIMATION then
			local name = name_of(player:animations(), message.animation)
			if name then
				player:add_animation(message.track or 0, name, message.loop ~= false, message.mix or 0, message.delay)
			end
		elseif message_id == MSG_CLEAR_TRACK then
			player:clear_track(message.track or 0)
		elseif message_id == MSG_STOP then
			player:stop()
		elseif message_id == MSG_SET_SKIN then
			player:set_skin(name_of(player:skins(), message.skin))
		elseif message_id == MSG_SET_SPEED then
			player:set_speed(message.speed or 1)
		elseif message_id == MSG_SET_TINT then
			player:set_tint(message.r or 1, message.g or 1, message.b or 1, message.a or 1)
		end
	end

	function c.final(self)
		players[go.get_id()] = nil
		if self.player then
			self.player:delete()
		end
	end

	return c
end

return M
