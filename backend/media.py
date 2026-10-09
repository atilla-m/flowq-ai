"""Validate and store one customer photo. Shared by the browser upload route and Twilio WhatsApp."""
from io import BytesIO
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from backend.db import now_iso

FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}


class MediaError(ValueError):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def save_image(db, settings, phone: str, data: bytes) -> dict:
    """Store verified image bytes for this customer and add the customer image to their inbox."""
    if len(data) > settings.max_upload_bytes:
        raise MediaError(413, "Images must be at most 10 MB")
    try:
        with Image.open(BytesIO(data)) as uploaded:
            image_format = uploaded.format
            if uploaded.width * uploaded.height > 30_000_000:
                raise MediaError(413, "Image dimensions are too large")
            uploaded.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise MediaError(415, "Upload a valid JPEG, PNG or WebP image") from error
    if image_format not in FORMATS:
        raise MediaError(415, "Upload a JPEG, PNG or WebP image")
    suffix, mime_type = FORMATS[image_format]
    media_id = "media_" + uuid4().hex
    path = settings.upload_dir / (media_id + suffix)
    path.write_bytes(data)
    url = f"{settings.backend_url}/api/media/{media_id}"
    with db.connection(write=True) as connection:
        connection.execute("INSERT INTO media VALUES (?, ?, ?, ?, ?, ?)",
                           (media_id, phone, now_iso(), str(path.resolve()), mime_type, url))
        db.add_message(phone, "customer", "image", image_url=url,
                       data={"media_id": media_id}, connection=connection)
    return {"media_id": media_id, "url": url}
