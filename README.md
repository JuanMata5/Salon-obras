# Salon de Obras

Sitio para presentar, votar y administrar obras del Salón Plein Air.

## Desarrollo local

1. Instalar Node.js.
2. Instalar dependencias con `npm install`.
3. Copiar `.env.example` a `.env` y completar la configuración privada.
4. Iniciar con `npm start`.
5. Abrir `http://localhost:3000`.

La aplicación local usa Express, SQLite y archivos guardados en `uploads/`. El panel administrativo está en `/admin`.

## Google Sheets

Configurar `GOOGLE_SHEETS_WEBHOOK_URL` con la URL de la aplicación web de Apps Script. El código de referencia está en `google-sheets-apps-script.js`; después de cambiarlo hay que implementar una nueva versión en Apps Script.

## Antes de producción en Vercel

El proyecto actual guarda datos en SQLite local y las imágenes en el disco local. El almacenamiento de una función serverless de Vercel no es persistente; por eso, **no se deben recibir obras reales en un despliegue Vercel de esta versión**, ya que los datos o las imágenes podrían perderse.

Antes de usarlo en producción, hay que migrar SQLite a una base administrada (por ejemplo, Postgres/Neon) y las imágenes a almacenamiento persistente (por ejemplo, Vercel Blob o S3), además de adaptar y validar las rutas Express como funciones serverless. Las variables privadas de `.env` se cargan en **Vercel → Project Settings → Environment Variables**; nunca se sube `.env` al repositorio.
