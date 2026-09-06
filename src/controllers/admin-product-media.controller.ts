import type { Request, Response } from "express";
import {
  createProductMediaUploadUrl,
} from "../services/product-media.service";

export async function createProductMediaUploadUrlController(
  req: Request,
  res: Response,
) {
  try {
    const {
      slug,
      fileName,
      contentType,
      size,
    } = req.body;

    if (
      typeof slug !== "string" ||
      typeof fileName !== "string" ||
      typeof contentType !== "string" ||
      typeof size !== "number"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "slug, fileName, contentType and size are required",
      });
    }

    const result =
      await createProductMediaUploadUrl({
        slug,
        fileName,
        contentType,
        size,
      });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "CREATE PRODUCT MEDIA UPLOAD URL ERROR:",
      error,
    );

    return res.status(400).json({
      success: false,
      message:  
        error instanceof Error
          ? error.message
          : "Unable to create upload URL",
    });
  }
}