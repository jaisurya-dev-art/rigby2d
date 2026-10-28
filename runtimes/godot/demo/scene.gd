# Demo: a scene exported from the Rigby2D editor. NILA and Rigbytron meet while the camera pans
# and the backgrounds drift by depth. A Camera2D follows the stage camera bone, framed like the
# editor's film output (1920 px wide at 1.2 world units per pixel; the bone's scale zooms in).
# Space: restart.
extends Node2D

const FRAME_WIDTH := 1920.0 * 1.2

@onready var scene: RigbyScene2D = $Scene
@onready var camera: Camera2D = $Camera


func _ready() -> void:
	scene.shot_finished.connect(func(shot): print("shot %s finished" % shot))


func _process(_delta: float) -> void:
	var cam := scene.get_camera_transform()
	camera.position = scene.position + cam.origin
	camera.zoom = Vector2.ONE * get_viewport_rect().size.x / FRAME_WIDTH * cam.get_scale().x


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_SPACE:
		scene.play(scene.get_current_shot(), true)
