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

1. Crea un proyecto en Supabase.
2. Copia `Project URL` y `anon public key` desde `Project Settings > API`.
3. Crea `.env.local` basado en `.env.example`.
4. En Supabase, agrega tus URLs en `Authentication > URL Configuration`.
5. Reinicia el servidor de Vite.

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

URLs recomendadas para desarrollo:

- `Site URL`: `http://localhost:5173`
- `Redirect URLs`: `http://localhost:5173`, `http://localhost:5173/**`

Para Vercel agrega tambien tu dominio de produccion, por ejemplo:

- `https://hessaenterprises.vercel.app`
- `https://hessaenterprises.vercel.app/**`

Para activar Google, configura el proveedor en `Authentication > Providers > Google` dentro de Supabase.

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
