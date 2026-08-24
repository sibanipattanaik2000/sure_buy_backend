import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createAddressSchema,
  updateAddressSchema,
} from "../validators/address.validator";

import {
  getUserAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../services/address.service";

export async function listAddresses(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const addresses = await getUserAddresses(req.userId);

    return res.status(200).json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    console.error("listAddresses error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch addresses",
    });
  }
}

export async function addAddress(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const result = createAddressSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid address data",
        errors: result.error.flatten(),
      });
    }

    const address = await createAddress(
      req.userId,
      result.data,
    );

    return res.status(201).json({
      success: true,
      message: "Address added successfully",
      data: address,
    });
  } catch (error) {
    console.error("addAddress error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add address",
    });
  }
}

export async function editAddress(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const id = String(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Address ID is required",
      });
    }

    const result = updateAddressSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid address data",
        errors: result.error.flatten(),
      });
    }

    const address = await updateAddress(
      req.userId,
      id,
      result.data,
    );

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: address,
    });
  } catch (error) {
    console.error("editAddress error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update address",
    });
  }
}

export async function removeAddress(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const id = String(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Address ID is required",
      });
    }

    const address = await deleteAddress(
      req.userId,
      id,
    );

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error) {
    console.error("removeAddress error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete address",
    });
  }
}

export async function makeDefaultAddress(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const id = String(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Address ID is required",
      });
    }

    const address = await setDefaultAddress(
      req.userId,
      id,
    );

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      data: address,
    });
  } catch (error) {
    console.error("makeDefaultAddress error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update default address",
    });
  }
}