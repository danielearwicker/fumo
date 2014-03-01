rm ../helloworld.nw
zip -r ../helloworld.nw . -x .idea\* example\* node_modules/selenium-webdriver/lib/test\* node_modules/selenium-webdriver/test\* node_modules/selenium-webdriver/docs\*
open -n -a node-webkit ../helloworld.nw



