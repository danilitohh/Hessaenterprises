# Hessa Follow Up Web

Aplicacion web en `React + TypeScript` para gestionar clientes y llevar seguimiento comercial con una secuencia de contactos programados.

## Que hace

- Registra clientes con nombre, correo, empresa y notas.
- Define hasta 4 contactos por cliente con hora especifica por intento.
- Guarda clientes, reglas y plantillas en `localStorage` del navegador.
- Abre cada correo como borrador en el cliente de correo predeterminado del usuario.
- Reprograma automaticamente el siguiente contacto segun el intervalo configurado.
- Finaliza el flujo cuando el cliente completa todos sus intentos.

## Como correrla

```bash
npm install
npm run dev
```

## Supabase Auth

La app usa Supabase Auth para registro, inicio de sesion, Google OAuth y recuperacion de contrasena.

La configuracion de auth ya esta funcionando y esta protegida por un candado de build. Antes de cambiar URLs, claves o providers, lee `AUTH_LOCK.md`.

Proyecto Supabase actual:

```bash
VITE_SUPABASE_URL=https://eaocwrgbqeakyycmtbah.supabase.co
VITE_SUPABASE_ANON_KEY=tu-publishable-o-anon-public-key
```

No uses `/rest/v1/` al final de `VITE_SUPABASE_URL`.

URLs requeridas en Supabase `Authentication > URL Configuration`:

- `Site URL`: `https://hessaenterprises.vercel.app`
- `Redirect URLs`: `https://hessaenterprises.vercel.app`, `https://hessaenterprises.vercel.app/**`

Google OAuth debe usar el callback de Supabase:

- `https://eaocwrgbqeakyycmtbah.supabase.co/auth/v1/callback`

Nunca pongas el Google client secret en el frontend. Ese secreto solo va en Supabase `Authentication > Sign In / Providers > Google`.

Para validar el candado de auth:

```bash
npm run check:auth-config
```

## Gmail Sending

La app incluye una integracion para que cada usuario conecte Gmail y los follow-ups puedan enviarse desde su propia cuenta.

El flujo seguro usa OAuth + Supabase Edge Functions. Si Gmail no esta conectado, la app mantiene el comportamiento actual y abre el borrador con `mailto:`.

Consulta `GMAIL_INTEGRATION.md` antes de desplegar o cambiar esta integracion.

## Build

```bash
npm run build
npm run preview
```

## Configuracion web

Desde la interfaz puedes configurar:

- `Correo de referencia`
- `Nombre visible`
- `Intervalo entre contactos`
- `Apertura automatica del primer borrador`
- `Asunto y cuerpo de la plantilla`

Tokens disponibles dentro de la plantilla:

- `{{name}}`
- `{{company}}`
- `{{companyOrName}}`
- `{{contactNumber}}`
- `{{maxContacts}}`
- `{{fromName}}`
- `{{fromEmail}}`
- `{{notes}}`
- `{{scheduledDate}}`
- `{{scheduledTime}}`

## Flujo de seguimiento

1. Se crea un cliente.
2. La app deja listo el contacto 1 para su horario programado.
3. Cuando abres el borrador de un intento, se agenda el siguiente contacto.
4. Cuando se completan todos los intentos, el cliente pasa a estado `finalizado`.

## Alcance actual

- Esta version no envia correos automaticamente desde un servidor.
- Los borradores se abren usando `mailto:` en el cliente de correo del usuario.
- Si luego quieres envio automatico real desde la web, necesitaremos agregar un backend o integrar un proveedor de correo.

## Validacion realizada

- `npm run lint`
- `npm run build`
