// SPDX-License-Identifier: MIT OR Apache-2.0
// Makes this object follow a bone of a RigbySkeleton: a sword in a hand, a hat on a head, a particle
// effect on a foot. Runs after the skeleton is posed each frame.

using UnityEngine;

namespace Rigby2D.Unity
{
    [ExecuteAlways]
    [DefaultExecutionOrder(1000)]
    [AddComponentMenu("Rigby2D/Rigby Bone Follower")]
    public sealed class RigbyBoneFollower : MonoBehaviour
    {
        [SerializeField] RigbySkeleton skeleton;
        [SerializeField] string bone = "";
        [SerializeField] bool followRotation = true;
        [Tooltip("Scale with the bone's world scale (relative to its setup scale of 1).")]
        [SerializeField] bool followScale;
        [Tooltip("Offset in the bone's space, in Unity units.")]
        [SerializeField] Vector2 offset;
        [SerializeField] float rotationOffset;

        int boneIndex = -1;
        SkeletonData boneData;
        Vector3 baseScale = Vector3.one;

        public RigbySkeleton Skeleton { get => skeleton; set { skeleton = value; boneData = null; } }
        public string Bone { get => bone; set { bone = value; boneData = null; } }

        void OnEnable()
        {
            baseScale = transform.localScale;
            if (skeleton == null) skeleton = GetComponentInParent<RigbySkeleton>();
        }

        void LateUpdate()
        {
            if (skeleton == null) return;
            skeleton.Refresh();
            if (skeleton.Data == null) return;
            if (boneData != skeleton.Data)
            {
                boneData = skeleton.Data;
                boneIndex = skeleton.FindBone(bone);
            }
            if (boneIndex < 0) return;
            var local = skeleton.GetBoneLocalMatrix(boneIndex);
            var world = skeleton.transform.localToWorldMatrix * local;
            var p = world.MultiplyPoint3x4(new Vector3(offset.x, offset.y, 0f));
            transform.position = new Vector3(p.x, p.y, transform.position.z);
            if (followRotation)
            {
                float angle = skeleton.GetBoneLocalRotation(boneIndex) + rotationOffset;
                transform.rotation = skeleton.transform.rotation * Quaternion.Euler(0f, 0f, angle);
            }
            if (followScale)
            {
                var s = skeleton.GetBoneScale(boneIndex);
                transform.localScale = new Vector3(baseScale.x * s.x, baseScale.y * s.y, baseScale.z);
            }
        }
    }
}
