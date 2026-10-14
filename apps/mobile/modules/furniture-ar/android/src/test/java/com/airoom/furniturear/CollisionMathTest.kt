package com.airoom.furniturear

import com.airoom.furniturear.CollisionMath.Body
import com.airoom.furniturear.CollisionMath.Footprint
import com.airoom.furniturear.CollisionMath.Segment
import com.airoom.furniturear.CollisionMath.Wall
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Runs the shared cases in `modules/furniture-ar/collision-cases.json`.
 * The Swift implementation (step 4) must run the same file.
 */
class CollisionMathTest {
  private val cases = JSONObject(File("../collision-cases.json").readText())
  private val margin = cases.getDouble("margin").toFloat()

  @Test
  fun `item vs item cases`() {
    val list = cases.getJSONArray("itemItem")
    assertTrue(list.length() > 0)
    for (i in 0 until list.length()) {
      val c = list.getJSONObject(i)
      val a = footprint(c.getJSONObject("a"))
      val b = footprint(c.getJSONObject("b"))
      val expected = c.getBoolean("collides")
      assertEquals(c.getString("name"), expected, CollisionMath.collides(a, b, margin))
      assertEquals("${c.getString("name")} (swapped)", expected, CollisionMath.collides(b, a, margin))
    }
  }

  @Test
  fun `item vs wall cases`() {
    val list = cases.getJSONArray("itemWall")
    assertTrue(list.length() > 0)
    for (i in 0 until list.length()) {
      val c = list.getJSONObject(i)
      val item = footprint(c.getJSONObject("item"))
      val wall = segment(c.getJSONObject("wall"))
      assertEquals(c.getString("name"), c.getBoolean("collides"), CollisionMath.collides(item, wall, margin))
    }
  }

  @Test
  fun `rule cases`() {
    val list = cases.getJSONArray("rules")
    assertTrue(list.length() > 0)
    for (i in 0 until list.length()) {
      val c = list.getJSONObject(i)
      val moving = body(c.getJSONObject("moving"))
      val current = c.optJSONObject("current")?.let(::footprint)
      val others = c.getJSONArray("others").let { arr -> (0 until arr.length()).map { body(arr.getJSONObject(it)) } }
      val walls = c.getJSONArray("walls").let { arr ->
        (0 until arr.length()).map { arr.getJSONObject(it).let { w -> Wall(w.getString("id"), segment(w)) } }
      }
      val expected = if (c.isNull("expected")) null else c.getString("expected")
      val actual = CollisionMath.blockedReason(moving, moving.footprint, current, others, walls, margin)?.jsName
      assertEquals(c.getString("name"), expected, actual)
    }
  }

  @Test
  fun `host wall cases`() {
    val list = cases.getJSONArray("hostWall")
    assertTrue(list.length() > 0)
    for (i in 0 until list.length()) {
      val c = list.getJSONObject(i)
      val item = footprint(c.getJSONObject("item"))
      val wall = segment(c.getJSONObject("wall"))
      assertEquals(c.getString("name"), c.getBoolean("host"), CollisionMath.isHostWall(item, wall))
    }
  }

  @Test
  fun `a body never collides with itself`() {
    val sofa = Body("sofa", Footprint(0f, 0f, 0f, 2f, 1f), isFloorCovering = false)
    assertEquals(null, CollisionMath.blockedReason(sofa, sofa.footprint, null, listOf(sofa), emptyList()))
  }

  private fun footprint(o: JSONObject) = Footprint(
    x = o.getDouble("x").toFloat(),
    z = o.getDouble("z").toFloat(),
    yawRadians = Math.toRadians(o.getDouble("yawDeg")).toFloat(),
    width = o.getDouble("width").toFloat(),
    depth = o.getDouble("depth").toFloat(),
    bottom = o.optDouble("bottom", Double.NEGATIVE_INFINITY).toFloat(),
    top = o.optDouble("top", Double.POSITIVE_INFINITY).toFloat(),
  )

  private fun segment(o: JSONObject) = Segment(
    o.getDouble("x1").toFloat(),
    o.getDouble("z1").toFloat(),
    o.getDouble("x2").toFloat(),
    o.getDouble("z2").toFloat(),
  )

  private fun body(o: JSONObject) =
    Body(o.getString("id"), footprint(o), o.getBoolean("rug"), o.optBoolean("wallMounted", false))
}
