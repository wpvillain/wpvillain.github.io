---
layout: post
title: "Zend Framework NGINX Virtualhost Configuration"
description: "Taking care of the Zend Framework NGINX virtualhost configuration  can be daunting at the beginning. For a Zend Framework web application we have done..."
date: 2016-12-11 16:09:15 +0000
categories: devops
tags: [configuration, devops, framework, nginx, virtualhost, wordpress, zend]
---

Taking care of the Zend Framework NGINX virtualhost configuration  can be daunting at the beginning. For a Zend Framework web application we have done this recently. And though it may be be the ideal setup we will be sharing it with you so you can learn from this and we hopefully again from you. Well. let's get to it shall we?
<h2>Virtualhost Location</h2>
Although again this may not be the ideal setup we have used:

```
/etc/nginx/conf.d/default.conf
```

<p class="p1"><span class="s1">to setup a virtualhost for our LEMP test server running the Zend Framework. </span></p>
<p class="p1"><span class="s1">Normally you will see this kind of contents there:</span></p>


```nginx
server {

  listen 80;

  server_name lemp.dev www.lemp.dev;

  root /usr/share/nginx/html/;

  index index.php index.html index.htm index.nginx-debian.html;

  location / {

    try_files $uri $uri/ =404;

  }

  error_page 404 /404.html;

  error_page 500 502 503 504 /50x.html;

  location = /50x.html {

    root /usr/share/nginx/html;

  }

  location ~ \.php$ {

    try_files $uri =404;

    fastcgi_pass unix:/run/php/php7.0-fpm.sock;

    fastcgi_index index.php;

    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

    include fastcgi_params;

  }

}
```

<p class="p1"><span class="s1">This is a configuration file setup based upon this <a href="https://github.com/mikesprague/vagrant-lemp" target="_blank">Vagrant Lemp setup</a>. </span></p>

<h2 class="p1"><span class="s1">General Nginx Configuration</span></h2>
<p class="p1"><span class="s1">In the general <a href="https://www.nginx.com/resources/wiki/start/topics/examples/full/" target="_blank">Nginx configuration file</a>:</span></p>


```
/etc/nginx/nginx.conf
```

<p class="p1"><span class="s1">this file is mentioned for setting up dealing with virtual hosts:</span></p>


```nginx
##

 # Virtual Host Configs

 ##

 include /etc/nginx/conf.d/*.conf;

 include /etc/nginx/sites-enabled/*;

}
```

<p class="p1"><span class="s1">It is basically the overview file for virtual hosts on your Nginx server. Not a bad place to take care of the Zend Framework NGINX virtualhost configuration, especially if you are ONLY just running one host. </span></p>

<h2 class="p1"><span class="s1">Sites-Enabled</span></h2>
<p class="p1"><span class="s1">With multiple hosts you are better of creating multiple inside sites-enabled:</span></p>


```
/etc/nginx/sites-enabled/
```

<p class="p1">And so for most multi user sites this is the place to store them. Will get into using this setup some time soon as we will be working on this and automating generating configs there.</p>

<h2 class="p1"><span class="s1">Default.conf</span></h2>
<p class="p1"><span class="s1">So, in that file:</span></p>


```
/etc/nginx/conf.d/default.conf
```

<p class="p1"><span class="s1">we have made the following configuration:</span></p>


```nginx
server {

  listen 443 ssl;

  server_name sub.domain.com;

  ssl_certificate /etc/letsencrypt/live/sub.domain.com/fullchain.pem;

  ssl_certificate_key /etc/letsencrypt/live/sub.domain.com/privkey.pem;
  

  ssl_protocols TLSv1 TLSv1.1 TLSv1.2;

  ssl_prefer_server_ciphers on;

  ssl_dhparam /etc/ssl/certs/dhparam.pem;

  ssl_ciphers 'ECDHE-RSA-KEY';

  ssl_session_timeout 1d;

  ssl_session_cache shared:SSL:50m;

  ssl_stapling on;

  ssl_stapling_verify on;

  add_header Strict-Transport-Security max-age=15768000;

  
  root /usr/share/nginx/app/ZendSkeletonApplication/public;

  index index.php index.html index.htm index.nginx-debian.html;

  
  location / {

    try_files $uri $uri/ /index.php$is_args$args;

  }

  location /phpmyadmin {

        root /usr/share/;

        index index.php index.html index.htm;

        location ~ ^/phpmyadmin/(.+\.php)$ {

                try_files $uri =404;

                root /usr/share/nginx/html;

                fastcgi_pass unix:/run/php/php7.0-fpm.sock;

                fastcgi_index index.php;

                fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

                include /etc/nginx/fastcgi_params;

        }

        location ~* ^/phpmyadmin/(.+\.(jpg|jpeg|gif|css|png|js|ico|html|xml|txt))$ {

                root /usr/share/;

        }

  }

  location ~ \.php$ {

    fastcgi_pass unix:/run/php/php7.0-fpm.sock;

    fastcgi_index index.php;

    fastcgi_param SCRIPT_FILENAME /usr/share/nginx/app/ZendSkeletonApplication/public/index.php;

    include fastcgi_params;

    fastcgi_read_timeout 300;

  }

}

server {

    listen 80;

    server_name sub.domain.com;

    return 301 https://$host$request_uri;

}
```

I will discuss some of the elements of this configuration here below.
<h2>Webroot Location</h2>
It is one of our very first Nginx setups on a VPS and we are not completely satisfied yet. But as root we have now:

```
root /usr/share/nginx/app/ZendSkeletonApplication/public;
```

We are considering moving all to:

```
/var/www/domain.com/public
```

This is the standard Debian/Ubuntu location and as we will be working with more sites, a lot more, in the future this seems like a more logical place. But for now this works and so this "root" is fine. Especially as this is a test environment and not a live environment.
<h2>SSL</h2>
You will also notice we have set up Let's Encrypt here:

```nginx
listen 443 ssl;

  server_name sub.domain.com;

  ssl_certificate /etc/letsencrypt/live/sub.domain.com/fullchain.pem;

  ssl_certificate_key /etc/letsencrypt/live/sub.domain.com/privkey.pem;
  

  ssl_protocols TLSv1 TLSv1.1 TLSv1.2;

  ssl_prefer_server_ciphers on;

  ssl_dhparam /etc/ssl/certs/dhparam.pem;

  ssl_ciphers 'ECDHE-RSA-KEY';

  ssl_session_timeout 1d;

  ssl_session_cache shared:SSL:50m;

  ssl_stapling on;

  ssl_stapling_verify on;

  add_header Strict-Transport-Security max-age=15768000;
```

I wrote about that earlier <a href="https://imagewize.com/lets-encrypt-and-zend-framework-on-nginx/">here</a>. A great solution for this test server. As we will be using extended validation for our live app we will be abandoning this in favor of one of our SSL partners. But for all out there needing a basic, free certificate, by all means do it!
<h2>phpMyAdmin</h2>
As you can see we also have added a location for phpMyAdmin:

```nginx
location /phpmyadmin {

        root /usr/share/;

        index index.php index.html index.htm;

        location ~ ^/phpmyadmin/(.+\.php)$ {

                try_files $uri =404;

                root /usr/share/nginx/html;

                fastcgi_pass unix:/run/php/php7.0-fpm.sock;

                fastcgi_index index.php;

                fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

                include /etc/nginx/fastcgi_params;

        }
```

Though we could possibly use Sequel Pro or Workbench for this we chose phpMyAdmin for accessing the database server. It is still rather convenient. For security reasons we will not be adding this to the live server.
<h2>HTTPS Redirect</h2>
We added a 301 redirect as a final server block at the end of the file:

```nginx
server {

    listen 80;

    server_name sub.domain.com;

    return 301 https://$host$request_uri;

}
```

It makes sure that all port 80 or http traffic goes to port 443 or https. This to make sure all traffic goes to the right location.

So there you go. A possible Zend Framework NGINX Virtualhost Configuration setup. Would love to hear from you Zend Framework gurus out there how your ideal staging setup has been made!
