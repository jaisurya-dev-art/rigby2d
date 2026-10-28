# SPDX-License-Identifier: MIT OR Apache-2.0
# Renders the scene demo at fixed times and saves the frames to tests/output/ (needs a renderer,
# so run it without --headless):
#   godot --path runtimes/godot --script res://tests/capture_scene.gd
extends SceneTree

const TIMES := [0.0, 2.0, 4.0, 7.0]


func _initialize() -> void:
	var demo: Node = load("res://demo/scene.tscn").instantiate()
	root.add_child(demo)
	_capture.call_deferred(demo)


func _capture(demo: Node) -> void:
	var scene: RigbyScene2D = demo.get_node("Scene")
	scene.playing = false
	demo.get_node("UI").visible = false
	DirAccess.make_dir_recursive_absolute("res://tests/output")
	var t := 0.0
	for i in TIMES.size():
		while t < TIMES[i] - 1e-6:
			scene.advance(1.0 / 30.0)
			t += 1.0 / 30.0
		await process_frame
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://tests/output/scene_%d.png" % i)
		print("saved scene_%d.png (t = %.2f s, %d batches)" % [i, scene.get_time(), scene.get_draw_batch_count()])
	quit(0)
