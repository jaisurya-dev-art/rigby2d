# Rig report

Catches rigging mistakes before you export.

## Tools

In the **Scripts** menu:

- **Rig report**: checks the open project and lists what it finds in *View ▸ Log*:
  - bones with no children and no slots (often leftovers)
  - slots with no attachments
  - bones whose names differ only by case, spaces or `_` (`Arm_L` and `arm l`)
  - empty animations

It only reads the project: nothing is changed.
