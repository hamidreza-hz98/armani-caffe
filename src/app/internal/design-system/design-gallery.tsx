"use client";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { LtrText } from "@/theme/bidi-text";
import { formatJalaliDate, formatPersianNumber, formatToman } from "@/theme/format";
import { colors } from "@/theme/tokens";

const swatches = [
  ["قهوه تیره", colors.brown],
  ["طلایی", colors.gold],
  ["زمینه", colors.canvas],
  ["سطح", colors.surface],
  ["موفق", colors.success],
  ["هشدار", colors.warning],
  ["خطا", colors.error],
] as const;

export function DesignGallery() {
  const [quantity, setQuantity] = useState(1);

  return (
    <Container component="main" maxWidth="lg" sx={{ py: { xs: 3, sm: 5, md: 8 } }}>
      <Stack spacing={4}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            گالری داخلی · طراحی رابط کاربری
          </Typography>
          <Typography component="h1" variant="h2">
            آرمانی کافه
          </Typography>
          <Typography color="text.secondary">پایهٔ بصری فارسی، راست‌به‌چپ و واکنش‌گرا</Typography>
        </Box>

        <Card>
          <CardContent>
            <Typography component="h2" variant="h5" gutterBottom>
              رنگ‌ها و سطوح
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
                gap: 2,
              }}
            >
              {swatches.map(([label, color]) => (
                <Box key={label}>
                  <Box
                    sx={{
                      height: 64,
                      borderRadius: 2,
                      bgcolor: color,
                      border: `1px solid ${colors.border}`,
                    }}
                  />
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    <LtrText>{color}</LtrText>
                  </Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography component="h2" variant="h5" gutterBottom>
              نوشتار و داده‌ها
            </Typography>
            <Typography variant="h3">قهوه‌ای برای لحظه‌های خوب</Typography>
            <Typography>قهوه تازه، طعم آشنا و تجربه‌ای دل‌نشین در آرمانی کافه.</Typography>
            <Divider sx={{ my: 2 }} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
              <Typography>قیمت: {formatToman(185000)}</Typography>
              <Typography>تعداد: {formatPersianNumber(quantity)}</Typography>
              <Typography>تاریخ: {formatJalaliDate("2026-09-27T12:00:00Z")}</Typography>
            </Stack>
            <Typography sx={{ mt: 2 }}>
              شماره سفارش: <LtrText>AC-0008932</LtrText> · تلفن: <LtrText>+98 21 1234 5678</LtrText>
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography component="h2" variant="h5" gutterBottom>
              کنترل‌ها و وضعیت‌ها
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Button variant="contained" onClick={() => setQuantity((value) => value + 1)}>
                افزودن
              </Button>
              <Button
                variant="outlined"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                کاهش
              </Button>
              <Button variant="text">مشاهده جزئیات</Button>
              <Chip label="موجود" color="success" />
              <Chip label="رو به اتمام" color="warning" />
              <Chip label="ناموجود" color="error" />
            </Stack>
            <TextField
              label="نام و نام خانوادگی"
              helperText="نمونهٔ فیلد فارسی"
              sx={{ mt: 3, width: { xs: "100%", sm: 320 } }}
            />
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
