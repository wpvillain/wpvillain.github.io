---
layout: post
title: "Digital Ocean Docker Machine Setup"
description: "To do a Digital Ocean Docker Machine Setup  Docker Machine makes your live really easy. Here is how your can provision and deploy with your docker-mac..."
date: 2018-05-08 11:14:45 +0000
categories: devops
tags: [devops, digital, docker, machine, ocean, setup, wordpress]
---

<p>To do a Digital Ocean Docker Machine Setup&nbsp; Docker Machine makes your live really easy. Here is how your can provision and deploy with your docker-machine.</p>



<h2 class="wp-block-heading">FYI</h2>



<p>If you have the Docker Client (Engine) installed on your Mac, Linux Box or PC you should have docker-machine available already. See more information on this <a href="https://docs.docker.com/machine/install-machine/">at Docker</a>.</p>



<h2 class="wp-block-heading">Trials on Existing Droplet</h2>



<p>Without a driver for an already existing host - Digital Ocean Docker setup I tried the following:</p>



<pre class="wp-block-preformatted">docker-machine env larastudio
Error checking TLS connection: Error checking and/or regenerating the certs: There was an error validating certificates for host "xxx.xxx.xx.xxx": dial tcp: address xxx.xxx.xx.xxx: missing port in address
You can attempt to regenerate them using 'docker-machine regenerate-certs [name]'.
Be advised that this will trigger a Docker daemon restart which might stop running containers.
</pre>



<p>So once I checked the setup one I was told the certs could not be checked. So I tried regerating them.&lt;pre&gt;</p>



<pre class="wp-block-preformatted">jasper@~/code/domain.com/laradock $ docker-machine regenerate-certs larastudio
Regenerate TLS machine certs? Warning: this is irreversible. (y/n): y
Regenerating TLS certificates
Waiting for SSH to be available...
Too many retries waiting for SSH to be available. Last error: Maximum number of retries (60) exceeded
</pre>



<p>Then did a:</p>



<pre class="wp-block-preformatted">docker-machine -D env larastudio
</pre>



<p>for a more detailed report. I got more errors</p>



<pre class="wp-block-preformatted">Getting to WaitForSSH function...
(larastudio) Calling .GetSSHHostname
(larastudio) Calling .GetSSHPort
(larastudio) Calling .GetSSHKeyPath
(larastudio) Calling .GetSSHUsername
Using SSH client type: external
&amp;{[-F /dev/null -o PasswordAuthentication=no -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=quiet -o ConnectionAttempts=3 -o ConnectTimeout=10 -o ControlMaster=no -o ControlPath=none @ -p 0] /usr/bin/ssh }
About to run SSH command:
exit 0
SSH cmd err, output: exit status 255: usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-b bind_address] [-c cipher_spec]
           [-D [bind_address:]port] [-E log_file] [-e escape_char]
           [-F configfile] [-I pkcs11] [-i identity_file]
           [-J [user@]host[:port]] [-L address] [-l login_name] [-m mac_spec]
           [-O ctl_cmd] [-o option] [-p port] [-Q query_option] [-R address]
           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]
           [user@]hostname [command]

Error getting ssh command 'exit 0' : ssh command error:
command : exit 0
err     : exit status 255
output  : usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-b bind_address] [-c cipher_spec]
           [-D [bind_address:]port] [-E log_file] [-e escape_char]
           [-F configfile] [-I pkcs11] [-i identity_file]
           [-J [user@]host[:port]] [-L address] [-l login_name] [-m mac_spec]
           [-O ctl_cmd] [-o option] [-p port] [-Q query_option] [-R address]
           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]
           [user@]hostname [command]


</pre>



<p>Then I found a <a href="https://forums.docker.com/t/how-can-docker-machine-add-an-exist-docker-host/7683">thread</a> with a more detailed command that seemed to be better.</p>



<pre class="wp-block-preformatted">docker-machine create --driver generic --generic-ip-address xxx.xxx.xx.xxx --generic-ssh-user root larastudio</pre>



<p>and it was able to connect, but I got a</p>



<pre class="wp-block-preformatted">Running pre-create checks...
Creating machine...
(larastudio) No SSH key specified. Assuming an existing key at the default location.
Waiting for machine to be running, this may take a few minutes...
Detecting operating system of created instance...
Waiting for SSH to be available...
Detecting the provisioner...
Provisioning with ubuntu(systemd)...
Error creating machine: Error running provisioning: ssh command error:
command :
if ! grep -xq '.*\slarastudio' /etc/hosts; then
if grep -xq '127.0.1.1\s.*' /etc/hosts; then
sudo sed -i 's/^127.0.1.1\s.*/127.0.1.1 larastudio/g' /etc/hosts;
else
echo '127.0.1.1 larastudio' | sudo tee -a /etc/hosts;
fi
fi
err : exit status 255
output :
</pre>



<p>Update: Read in <a href="https://www.digitalocean.com/community/questions/how-can-i-attach-docker-machine-to-an-existing-droplet-created-with-another-docker-machine">this Digital Ocean thread</a> that you can do it, but you need to be more specific about the ssh user and ssh key you use as well as having port 2376 open. Command I needed was:</p>



<pre class="wp-block-preformatted">docker-machine create \
    --driver=generic \
    --generic-ip-address=IP_ADDRESS \
    --generic-ssh-user=USERNAME \
    --generic-ssh-key=PATH_TO_SSH_KEY \
    --generic-ssh-port=PORT \
        MACHINE_NAME
</pre>



<p>&nbsp;</p>



<h2 class="wp-block-heading">Provisioning New Droplet</h2>



<p>Then I realized it was not working on a machine that was already up and running with Docker. So I did a:</p>



<pre class="wp-block-preformatted">docker-machine create --driver digitalocean --digitalocean-access-token 1111111 domain-docker</pre>



<p>and that worked:</p>



<pre class="wp-block-preformatted">Running pre-create checks...
Creating machine...
(smart48-docker) Creating SSH key...
(smart48-docker) Creating Digital Ocean droplet...
(smart48-docker) Waiting for IP address to be assigned to the Droplet...
Waiting for machine to be running, this may take a few minutes...
Detecting operating system of created instance...
Waiting for SSH to be available...
Detecting the provisioner...
Provisioning with ubuntu(systemd)...
Installing Docker...
Copying certs to the local machine directory...
Copying certs to the remote machine...
Setting Docker configuration on the remote daemon...
Checking connection to Docker...
Docker is up and running!
To see how to connect your Docker Client to the Docker Engine running on this virtual machine, run: docker-machine env smart48-docker
</pre>



<p>But I did not use enough parameters so I got a 1GB Droplet at the NYC zone. So I did a</p>



<pre class="wp-block-preformatted">docker-machine create --driver digitalocean -h</pre>



<p>to see all options. And I saw I could use</p>



<ul class="wp-block-list">
<li>--digitalocean-region "ams2"</li>



<li>--digitalocean-ipv6</li>



<li>--digitalocean-size "s-1vcpu-1gb"</li>
</ul>



<p>among others. So I did a</p>



<pre class="wp-block-preformatted">docker-machine create --driver digitalocean --digitalocean-region "ams2" --digitalocean-ipv6 --digitalocean-monitoring --digitalocean-access-token 1111111 domain-docker
</pre>



<p>and that worked even better.</p>



<h2 class="wp-block-heading">Working on the Remote Machine</h2>



<p>Then to do work on that machine you can do</p>



<pre class="wp-block-preformatted">eval $(docker-machine env <span class="highlight">machine-name</span>)</pre>



<p>and start running <em>docker-compose</em> and <em>docker</em> commands on the remote server. FYI docker-compose did not get installed on the remote for some reason. So that you can only use locally.</p>



<h2 class="wp-block-heading">Docker Machine Envs</h2>



<p>To check what envs are being used you can do a</p>



<pre class="wp-block-preformatted">env | grep DOCKER</pre>



<p>You will then see how things are setup. This so you know where you are working or what you are working on. And these details you can use to remove them or <a href="https://docs.docker.com/machine/get-started/#unset-environment-variables-in-the-current-shell">unset</a> them. You can check your envs to unset with</p>



<pre class="wp-block-preformatted">docker-machine env -u</pre>



<p>To return to localhost for docker you can do a</p>



<pre class="wp-block-preformatted">eval $(docker-machine env -u)</pre>



<h2 class="wp-block-heading">SSH Remote Machine</h2>



<p>You can also ssh into the box using</p>



<pre class="wp-block-preformatted"> docker-machine ssh box</pre>



<p>And as stated you can access the machine that way. FYIs, ssh-ing as root does no longer seems to work and as stated docker-compose is not installed on the DO Droplet.</p>



<div style="height:32px" aria-hidden="true" class="wp-block-spacer"></div>



<div class="wp-block-group has-tertiary-background-color has-background" style="border-left-color:#10b981;border-left-width:4px;padding-top:1.5rem;padding-right:1.5rem;padding-bottom:1.5rem;padding-left:1.5rem">
<h3 class="wp-block-heading">Done Managing Your Own Server?</h3>



<p>We run production WordPress and WooCommerce stacks on Hetzner using Trellis — Nginx, PHP 8.3, Redis, automated deployments, and Bedrock structure. No shared hosting, no page builders, no surprises.</p>



<ul class="wp-block-list">
<li>Trellis + Bedrock on Hetzner EU (Frankfurt / Helsinki)</li>



<li>Nginx + FastCGI caching + Redis object cache</li>



<li>Automated deployments via Ansible, SSL via Let's Encrypt</li>



<li>From €49/month — or €65/hour for one-off server work</li>
</ul>



<div class="wp-block-buttons">
<div class="wp-block-button"><a class="wp-block-button__link has-base-color has-primary-background-color has-text-color has-background wp-element-button" href="https://imagewize.com/contact/?service=trellis-hosting" style="border-radius:8px">Get a Quote</a></div>



<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="https://imagewize.com/services/managed-wordpress-hosting/" style="border-radius:8px">View Trellis Hosting</a></div>
</div>
</div>
