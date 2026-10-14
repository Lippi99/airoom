package com.airoom.furniturear

import com.airoom.furniturear.ArMath.Ray
import com.airoom.furniturear.ArMath.StandingBox
import com.airoom.furniturear.ArMath.Vec3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs

class ArMathTest {
  private val eps = 1e-4f
  private val halfPi = (PI / 2).toFloat()

  // A 2 m wide, 1 m deep, 0.8 m tall sofa standing at the origin.
  private val sofa = StandingBox(Vec3(0f, 0f, 0f), 0f, width = 2f, depth = 1f, height = 0.8f)

  @Test
  fun `ray hits the front face of a box`() {
    val ray = Ray(Vec3(0f, 0.4f, 5f), Vec3(0f, 0f, -1f))
    assertEquals(4.5f, ArMath.intersect(ray, sofa)!!, eps)
  }

  @Test
  fun `ray above the box misses`() {
    val ray = Ray(Vec3(0f, 1.0f, 5f), Vec3(0f, 0f, -1f))
    assertNull(ArMath.intersect(ray, sofa))
  }

  @Test
  fun `ray pointing away misses`() {
    val ray = Ray(Vec3(0f, 0.4f, 5f), Vec3(0f, 0f, 1f))
    assertNull(ArMath.intersect(ray, sofa))
  }

  @Test
  fun `yaw is respected - a rotated box is hit where its long side now is`() {
    // Rotated 90°, the 2 m side runs along Z: x = 0.8 is outside, z = 0.8 is inside.
    val rotated = sofa.copy(yawRadians = halfPi)
    val alongZ = Ray(Vec3(5f, 0.4f, 0.8f), Vec3(-1f, 0f, 0f))
    val alongX = Ray(Vec3(0.8f, 0.4f, 5f), Vec3(0f, 0f, -1f))
    assertNotNull(ArMath.intersect(alongZ, rotated))
    assertNull(ArMath.intersect(alongX, rotated))
    assertNotNull(ArMath.intersect(alongX, sofa))
  }

  @Test
  fun `ray starting inside the box hits at distance zero`() {
    val ray = Ray(Vec3(0f, 0.4f, 0f), Vec3(0f, 0f, -1f))
    assertEquals(0f, ArMath.intersect(ray, sofa)!!, eps)
  }

  @Test
  fun `pickClosest returns the nearest box`() {
    val near = sofa.copy(bottomCenter = Vec3(0f, 0f, 2f))
    val far = sofa.copy(bottomCenter = Vec3(0f, 0f, -2f))
    val ray = Ray(Vec3(0f, 0.4f, 10f), Vec3(0f, 0f, -1f))
    assertEquals(1, ArMath.pickClosest(ray, listOf(far, near)))
    assertNull(ArMath.pickClosest(Ray(Vec3(10f, 0.4f, 10f), Vec3(0f, 0f, -1f)), listOf(far, near)))
  }

  @Test
  fun `angleDelta wraps around pi`() {
    assertEquals(0.2f, ArMath.angleDelta(3.0f, 3.2f), eps)
    assertEquals(0.2f, ArMath.angleDelta(3.1f, -2.9831855f), eps) // crosses +pi to -pi
    assertEquals(-0.2f, ArMath.angleDelta(-3.1f, 2.9831855f), eps)
  }

  @Test
  fun `clockwise twist on screen gives a negative yaw`() {
    // Screen y points down, so a clockwise twist increases the screen angle.
    val delta = ArMath.angleDelta(ArMath.twistAngle(0f, 0f, 1f, 0f), ArMath.twistAngle(0f, 0f, 1f, 1f))
    assert(delta > 0f)
    assert(ArMath.yawDeltaForTwist(delta) < 0f)
  }

  @Test
  fun `yawFacing turns the item front toward the target`() {
    val origin = Vec3(0f, 0f, 0f)
    assertEquals(0f, ArMath.yawFacing(origin, Vec3(0f, 1.5f, 3f)), eps) // camera on +Z
    assertEquals(halfPi, ArMath.yawFacing(origin, Vec3(3f, 1.5f, 0f)), eps) // camera on +X
  }

  @Test
  fun `invert gives the identity when multiplied back`() {
    val m = floatArrayOf(2f, 0f, 0f, 0f, 0f, 3f, 0f, 0f, 0f, 0f, 4f, 0f, 1f, 2f, 3f, 1f)
    val product = ArMath.multiply(m, ArMath.invert(m)!!)
    val identity = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)
    product.indices.forEach { assertEquals(identity[it], product[it], eps) }
  }

  @Test
  fun `screenRay through the center looks down the camera axis`() {
    // Camera at (0, 1.5, 3) looking toward -Z: view matrix = translate(0, -1.5, -3).
    val view = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, -1.5f, -3f, 1f)
    val ray = ArMath.screenRay(500f, 1000f, 1000, 2000, view, perspective(60f, 0.5f, 0.1f, 100f))!!
    assertEquals(0f, ray.origin.x, 1e-3f)
    assertEquals(1.5f, ray.origin.y, 1e-3f)
    assertEquals(-1f, ray.direction.z, 1e-3f)
    // ...and it hits a sofa standing 3 m in front of the camera.
    assertNotNull(ArMath.intersect(ray.copy(origin = ray.origin.copy(y = 0.4f)), sofa))
  }

  @Test
  fun `screenRay to the right of center points right`() {
    val identity = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)
    val ray = ArMath.screenRay(900f, 1000f, 1000, 2000, identity, perspective(60f, 0.5f, 0.1f, 100f))!!
    assert(ray.direction.x > 0f)
    assertNull(ArMath.screenRay(0f, 0f, 0, 0, identity, identity))
  }

  /** Column-major OpenGL perspective matrix. */
  private fun perspective(fovYDeg: Float, aspect: Float, near: Float, far: Float): FloatArray {
    val f = (1.0 / kotlin.math.tan(Math.toRadians(fovYDeg / 2.0))).toFloat()
    return floatArrayOf(
      f / aspect, 0f, 0f, 0f,
      0f, f, 0f, 0f,
      0f, 0f, (far + near) / (near - far), -1f,
      0f, 0f, 2f * far * near / (near - far), 0f,
    )
  }

  // A 1.2 x 0.9 m painting, 4.5 cm deep, hanging on the wall z = 0 (facing +Z), center 1.5 m up.
  private val painting = ArMath.wallItemBox(Vec3(0f, 1.5f, 0f), 0f, width = 1.2f, depth = 0.045f, height = 0.9f)

  @Test
  fun `wall item box stands off the wall, centered on its back`() {
    assertEquals(0f, painting.bottomCenter.x, eps)
    assertEquals(1.05f, painting.bottomCenter.y, eps)
    assertEquals(0.0225f, painting.bottomCenter.z, eps)
    val atCenter = Ray(Vec3(0f, 1.5f, 3f), Vec3(0f, 0f, -1f))
    assertEquals(3f - 0.045f, ArMath.intersect(atCenter, painting)!!, eps)
    // The wall just above the frame is not the painting.
    assertNull(ArMath.intersect(Ray(Vec3(0f, 2.0f, 3f), Vec3(0f, 0f, -1f)), painting))
  }

  @Test
  fun `wall item box follows the wall's yaw`() {
    // On a wall facing +X: the painting's width now runs along Z.
    val turned = ArMath.wallItemBox(Vec3(0f, 1.5f, 0f), halfPi, width = 1.2f, depth = 0.045f, height = 0.9f)
    assertNotNull(ArMath.intersect(Ray(Vec3(3f, 1.5f, 0.5f), Vec3(-1f, 0f, 0f)), turned))
    assertNull(ArMath.intersect(Ray(Vec3(3f, 1.5f, 0.7f), Vec3(-1f, 0f, 0f)), turned))
  }

  @Test
  fun `ray meets a wall plane`() {
    val wallPoint = Vec3(0f, 0f, -2f)
    val normal = Vec3(0f, 0f, 1f)
    val hit = ArMath.intersectPlane(Ray(Vec3(1f, 1.5f, 0f), Vec3(0f, 0f, -1f)), wallPoint, normal)!!
    assertEquals(1f, hit.x, eps)
    assertEquals(1.5f, hit.y, eps)
    assertEquals(-2f, hit.z, eps)
    // Parallel to the wall, or looking away from it: no hit.
    assertNull(ArMath.intersectPlane(Ray(Vec3(0f, 1f, 0f), Vec3(1f, 0f, 0f)), wallPoint, normal))
    assertNull(ArMath.intersectPlane(Ray(Vec3(0f, 1f, 0f), Vec3(0f, 0f, 1f)), wallPoint, normal))
  }

  @Test
  fun `wall items face out of the wall, toward the viewer`() {
    val onWall = Vec3(0f, 1.5f, 0f)
    // Wall z = 0, viewer in front (+Z): yaw 0 whichever way ARCore's normal points.
    assertEquals(0f, ArMath.yawOutOfWall(Vec3(0f, 0f, 1f), onWall, Vec3(0f, 1.6f, 2f))!!, eps)
    assertEquals(0f, ArMath.yawOutOfWall(Vec3(0f, 0f, -1f), onWall, Vec3(0f, 1.6f, 2f))!!, eps)
    // Wall x = 0 seen from +X: front turned to +X.
    assertEquals(halfPi, ArMath.yawOutOfWall(Vec3(-1f, 0.1f, 0f), onWall, Vec3(3f, 1.6f, 0.5f))!!, eps)
    // A horizontal surface is not a wall.
    assertNull(ArMath.yawOutOfWall(Vec3(0.1f, 1f, 0f), onWall, Vec3(0f, 1.6f, 2f)))
  }

  /** A 3x3 grid of points on the wall z = -2 (x and y spread), with a little depth noise. */
  private fun plainWall(noise: Float = 0.01f): List<Vec3> {
    val r = java.util.Random(3)
    return listOf(-0.3f, 0f, 0.3f).flatMap { x ->
      listOf(1.2f, 1.5f, 1.8f).map { y -> Vec3(x, y, -2f + (r.nextFloat() - 0.5f) * 2 * noise) }
    }
  }

  @Test
  fun `a plain wall measured as points gives the wall's yaw`() {
    val viewer = Vec3(0f, 1.6f, 0f)
    assertEquals(0f, ArMath.wallYawFromPoints(plainWall(), viewer)!!, 0.03f)
    // Seen from behind (viewer at z = -4), the item faces the other way.
    assertEquals(PI.toFloat(), abs(ArMath.wallYawFromPoints(plainWall(), Vec3(0f, 1.6f, -4f))!!), 0.03f)
  }

  @Test
  fun `a stray sample on the floor is dropped from the wall fit`() {
    val points = plainWall() + Vec3(0.1f, 0f, -1.4f)
    assertEquals(0f, ArMath.wallYawFromPoints(points, Vec3(0f, 1.6f, 0f))!!, 0.03f)
  }

  @Test
  fun `points that are not a wall give no yaw`() {
    val viewer = Vec3(0f, 1.6f, 0f)
    // A floor patch: spread in both X and Z.
    val floor = listOf(-0.3f, 0f, 0.3f).flatMap { x -> listOf(-1.7f, -2f, -2.3f).map { z -> Vec3(x, 0f, z) } }
    assertNull(ArMath.wallYawFromPoints(floor, viewer))
    // Too few points, or all at the same spot.
    assertNull(ArMath.wallYawFromPoints(plainWall().take(3), viewer))
    assertNull(ArMath.wallYawFromPoints(List(9) { Vec3(0f, 1.5f, -2f) }, viewer))
  }

  @Test
  fun `a wall at an angle is measured at that angle`() {
    // Wall through the origin turned 30 degrees: points along (cos 30, -sin 30) seen from +Z side.
    val a = Math.toRadians(30.0)
    val points = listOf(-0.4f, -0.2f, 0f, 0.2f, 0.4f).flatMap { t ->
      listOf(1.3f, 1.7f).map { y -> Vec3((t * kotlin.math.cos(a)).toFloat(), y, (-t * kotlin.math.sin(a)).toFloat()) }
    }
    assertEquals(a.toFloat(), ArMath.wallYawFromPoints(points, Vec3(1f, 1.6f, 2f))!!, 0.01f)
  }

  @Test
  fun `project is the inverse of screenRay`() {
    // Camera at (0, 1.5, 3) looking down -Z; simple perspective (90 deg vertical FOV).
    val view = floatArrayOf(
      1f, 0f, 0f, 0f,
      0f, 1f, 0f, 0f,
      0f, 0f, 1f, 0f,
      0f, -1.5f, -3f, 1f, // column-major: translation in the last column
    )
    val near = 0.1f
    val far = 100f
    val projection = floatArrayOf(
      1f, 0f, 0f, 0f,
      0f, 1f, 0f, 0f,
      0f, 0f, -(far + near) / (far - near), -1f,
      0f, 0f, -2f * far * near / (far - near), 0f,
    )
    val point = Vec3(0.4f, 1.8f, 0f)
    val (x, y) = ArMath.project(point, 1000, 2000, view, projection)!!
    val ray = ArMath.screenRay(x, y, 1000, 2000, view, projection)!!
    // The ray through that pixel passes through the point.
    val t = (point.z - ray.origin.z) / ray.direction.z
    assertEquals(point.x, ray.origin.x + ray.direction.x * t, 1e-3f)
    assertEquals(point.y, ray.origin.y + ray.direction.y * t, 1e-3f)
    // Behind the camera: no pixel.
    assertNull(ArMath.project(Vec3(0f, 1.5f, 5f), 1000, 2000, view, projection))
  }
}
