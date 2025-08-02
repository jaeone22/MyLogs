# MyLogs

MyLogs is simple, clean, and easy to set up blogging service like wordpress.

Unlike WordPress, MyLogs doesn't have user accounts, you create/manage posts, etc. with a password you set in the .env file on your server.

It's built with NodeJS and you can finish the installation with a single line of command.

# Install server

Quick Server Install is available for macOS and Ubuntu.

For macOS, you must have [Homebrew](https://brew.sh) installed.

### 1. Install MyLogs

Run the script below in a terminal.

```bash
curl -fsSL https://gist.github.com/jaeone22/0561528c3d478d4bbf0cebe2e66a6d79/raw | bash
```

### 2. Config settings

Run the script below in a terminal or open the `~/MyLogs/.env` file with a text editor.

```bash
nano ~/MyLogs/.env
```

Then edit your `ADMIN_PASSWORD`, `ML_BLOG_NAME`, and more.

I recommend that you make it difficult for anyone who knows your `ADMIN_PASSWORD` to edit, delete, etc. your blog posts.

### 3. Start server

Run the script below in a terminal.

```bash
~/MyLogs && npm start
```

Then, your MyLog server should now be started on `localhost:3000`

# Manage your blog

Open a `localhost:3000/admin`.

Then, in the Password input, enter the password you set earlier.

## Upload a post

From the admin page, click `✏️ Create New Post`.

Then enter a title, category, and content.

MyLogs supports Markdown and some HTML formats.

When you're done, click the Save button to upload your post.
