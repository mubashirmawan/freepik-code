import express from "express";
import prisma from "../db.js";

const router = express.Router();

// Create user
router.post("/", async (req, res) => {
  try {
    const dto = req.body;
    const userExists = await findOne(dto.wId);
    if (userExists.length != 0) {
      return res
        .status(400)
        .json({ error: `User with wId ${dto.wId} already exist.` });
    }
    const user = await createUser(dto);
    res.json(
      `✅ User created: ${user.name} : (${user.wId}) - Plan: ${user.subscription.plan}.`
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all users
router.get("/", async (req, res) => {
  const users = await findAll();
  console.log("Users", users);
  if (users.length > 0) {
    res.json(users);
  }
  return res.status(404).json({ error: "No users found." });
});

// Get one user by wId
router.get("/one", async (req, res) => {
  try {
    const wId = req.query.id;

    if (!wId) {
      return res.status(400).json({ error: "Missing id parameter" });
    }

    const user = await prisma.user.findUnique({
      where: { wId },
      include: {
        subscription: true, // 👈 Include subscription details (includes expiresAt)
        Request: true, // 👈 Include user’s requests if you want
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { wId: req.body.wId },
    include: { subscription: true, Request: true },
  });

  if (!user) {
    return res
      .status(404)
      .json({ error: `User with wId ${req.body.wId} not found.` });
  }

  await prisma.request.deleteMany({
    where: { userId: user.id },
  });

  await prisma.subscription.deleteMany({
    where: { userId: user.id },
  });

  await prisma.user.delete({
    where: { wId: req.body.wId },
  });

  res.json("✅ User deleted");
});

// ✅ Patch subscription using wId
router.patch("/", async (req, res) => {
  try {
    const { wId, name, subscription } = req.body;

    if (!wId) {
      return res.status(400).json({ error: "wId is required" });
    }

    // Check if user exists
    const userExists = await findOne(wId);
    if (!userExists || userExists.length === 0) {
      return res.status(404).json({ error: `User with wId ${wId} not found.` });
    }

    // Update user info (e.g., name)
    const updatedUser = await updateUserDetails(wId, { name });

    // Update subscription separately if provided
    let updatedSubscription = null;
    if (subscription?.plan && subscription?.expiresAt) {
      updatedSubscription = await updateUserSubscription(wId, subscription);
    }

    res.json({
      message: "✅ User and subscription updated successfully",
      user: updatedUser,
      subscription: updatedSubscription,
    });
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(400).json({ error: err.message });
  }
});

async function createUser(dto) {
  return await prisma.user.create({
    data: {
      wId: dto.wId,
      name: dto.name,
      subscription: {
        create: {
          plan: dto.subscription.plan,
          expiresAt: dto.subscription.expiresAt
            ? new Date(dto.subscription.expiresAt)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // fallback to +30 days
        },
      },
    },
    include: {
      subscription: true,
    },
  });
}

async function findAll() {
  return await prisma.user.findMany({
    include: { subscription: true, Request: true },
  });
}

async function findOne(wId) {
  return await prisma.user.findMany({
    where: { wId },
    include: { subscription: true, Request: true },
  });
}

async function createRequest(userId) {
  const request = await prisma.request.create({
    data: { userId },
  });

  return request;
}

async function updateUserDetails(wId, dto) {
  console.log(`📝 Updating user: ${wId} with data:`, dto);

  const user = await prisma.user.update({
    where: { wId },
    data: {
      ...(dto.name && { name: dto.name }),
    },
  });

  return user;
}

// ✅ Update subscription helper (by wId)
async function updateUserSubscription(wId, dto) {
  console.log(
    `🔄 Updating subscription for wId: ${wId} with plan: ${dto.plan} and expiry: ${dto.expiresAt}`
  );

  // Get user id from wId
  const user = await prisma.user.findUnique({
    where: { wId },
    select: { id: true },
  });

  if (!user) throw new Error(`User with wId ${wId} not found`);

  const subscription = await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {
      plan: dto.plan,
      expiresAt: new Date(dto.expiresAt),
      reminderDay7Send: false,
      reminderDay4Send: false,
      reminderDay1Send: false,
    },
    create: {
      userId: user.id,
      plan: dto.plan,
      expiresAt: new Date(dto.expiresAt),
      reminderDay7Send: false,
      reminderDay4Send: false,
      reminderDay1Send: false,
    },
  });

  return subscription;
}

export default router;
