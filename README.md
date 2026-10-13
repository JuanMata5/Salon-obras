# Salon de Obras

Sitio para presentar, votar y administrar obras del Salón Plein Air.

## Desarrollo local

1. Instalar Node.js.
2. Instalar dependencias con `npm install`.
3. Copiar `.env.example` a `.env` y completar la configuración privada.
4. Iniciar con `npm start`.
5. Abrir `http://localhost:3000`.

La aplicación local usa Express, SQLite y archivos guardados en `uploads/`. El panel administrativo está en `/admin`.

## Google Sheets y Drive

Configurar `GOOGLE_SHEETS_WEBHOOK_URL` con la URL de la aplicación web de Apps Script. En producción, Sheets guarda los datos y Drive aloja las imágenes subidas.

Antes de cada despliegue que cambie `google-sheets-apps-script.js`, copiar el código al proyecto Apps Script, autorizar los permisos de Sheets y Drive, y publicar una nueva versión de la aplicación web. El servidor valida que responda `sheets-drive-v3` y rechaza escrituras si el Web App no está actualizado.

Si Apps Script indica que no hay permiso para `DriveApp.createFile`, activar la visualización del manifiesto `appsscript.json` en la configuración del editor, copiar allí el manifiesto del repositorio y ejecutar manualmente `authorizeStorage()` desde el editor. Aceptar el consentimiento de Google y luego actualizar la implementación como nueva versión.

El desarrollo local sigue usando SQLite y `uploads/`. En Vercel, la lectura se hace desde Sheets y las imágenes nuevas se guardan en Drive para no depender del `/tmp` efímero.

Las variables privadas de `.env` se cargan en **Vercel → Project Settings → Environment Variables**; nunca se sube `.env` al repositorio.

Para que los enlaces compartidos y el sitemap usen el dominio definitivo, configurar `PUBLIC_SITE_URL` en Vercel con la URL pública completa, por ejemplo `https://tudominio.com` (sin `/` al final). Si no se configura, el sitio usa el dominio de producción de Vercel o el host de la solicitud.
